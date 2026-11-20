"""Report 등록 (SRS 4.2) 과 사진 제공."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models as m
from ..auth import current_user
from ..config import settings
from ..db import get_db
from ..photos import FILE_NAME_RE, PhotoError, clean_image, delete_file, save_file, upload_dir
from ..services import auto_subscribe, guess_category, guess_floor

router = APIRouter(tags=["reports"])

TITLE_MAX = 100
BODY_MIN, BODY_MAX = 5, 2000


class ReportCreated(BaseModel):
    report_id: int
    topic_id: int
    # 연결 결과: 새 의제 생성 / 기존 의제 연결 (REQ-UI-21)
    link: str


def _field_errors(errors: dict[str, str]) -> HTTPException:
    # 입력 오류는 항목별 사유를 함께 돌려준다 (REQ-COM-02, NFR-Q03)
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"type": "validation", "fields": errors})


def _title_from_body(body: str) -> str:
    first = body.strip().splitlines()[0].strip()
    return first if len(first) <= 60 else first[:59] + "…"


@router.post("/api/reports", response_model=ReportCreated, status_code=status.HTTP_201_CREATED)
async def create_report(
    body: str = Form(...),
    client_request_id: str = Form(..., min_length=8, max_length=64),
    title: str = Form(""),
    type: str = Form("issue"),
    building_id: int | None = Form(None),
    floor: str = Form(""),
    photo: list[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
    user: m.User = Depends(current_user),
):
    # 같은 요청이 재전송되면 새로 만들지 않고 처음 결과를 돌려준다 (REQ-REG-12)
    existing = db.scalar(select(m.Report).where(m.Report.client_request_id == client_request_id))
    if existing is not None:
        if existing.author_id != user.id:
            raise HTTPException(status.HTTP_409_CONFLICT, detail={"type": "duplicate_request"})
        link = db.scalar(select(m.ReportLink.method).where(m.ReportLink.report_id == existing.id))
        return ReportCreated(report_id=existing.id, topic_id=existing.topic_id, link=link or "new_topic")

    errors: dict[str, str] = {}
    body = body.strip()
    title = title.strip()
    floor = floor.strip()

    # 데모 범위: 등록은 Issue만 다룬다 (데모 문서 1.5). Proposal 등록은 발표에서 설명.
    if type != "issue":
        errors["type"] = "이번 데모에서는 Issue만 등록할 수 있어요."
    if len(body) < BODY_MIN:
        errors["body"] = f"내용을 {BODY_MIN}자 이상 적어 주세요."
    elif len(body) > BODY_MAX:
        errors["body"] = f"내용은 {BODY_MAX}자까지 적을 수 있어요."
    if len(title) > TITLE_MAX:
        errors["title"] = f"제목은 {TITLE_MAX}자까지 적을 수 있어요."
    if len(floor) > 30:
        errors["floor"] = "층·위치는 30자까지 적을 수 있어요."

    building = db.get(m.Building, building_id) if building_id is not None else None
    if building is None:
        errors["building_id"] = "장소를 선택해 주세요."

    photos = [p for p in photo if p.filename]
    cleaned: list[tuple[bytes, str, str]] = []
    if len(photos) > settings.photo_max_count:
        errors["photo"] = f"사진은 {settings.photo_max_count}장까지 첨부할 수 있어요."
    else:
        for p in photos:
            data = await p.read(settings.photo_max_bytes + 1)
            try:
                cleaned.append(clean_image(data))
            except PhotoError as e:
                errors["photo"] = f"{p.filename}: {e}"

    if errors:
        raise _field_errors(errors)

    now = datetime.now(timezone.utc)
    title = title or _title_from_body(body)
    floor_value = floor or guess_floor(f"{title} {body}")
    saved: list[str] = []
    try:
        for content, ext, content_type in cleaned:
            saved.append(save_file(content, ext))

        # 비슷한 의제가 없으므로 새 의제로 등록한다. (기존 의제 연결은 Increment 3의 AI 추천에서)
        topic = m.Topic(
            type="issue",
            title=title,
            summary=body if len(body) <= 120 else body[:119] + "…",
            category=guess_category(f"{title} {body}"),
            building_id=building.id,
            floor=floor_value,
            status="backlog",            # 새 의제의 초기 상태 (FR-STAT-01)
            delivery_status="not_sent",
            last_report_at=now,
        )
        db.add(topic)
        db.flush()

        report = m.Report(
            author_id=user.id,
            topic_id=topic.id,
            title=title,
            body=body,
            building_id=building.id,
            floor=floor_value,
            lang="ko",
            client_request_id=client_request_id,
        )
        db.add(report)
        db.flush()

        for name, (content, _ext, content_type) in zip(saved, cleaned):
            db.add(m.Photo(report_id=report.id, file_name=name, content_type=content_type, size_bytes=len(content)))

        db.add(m.ReportLink(report_id=report.id, topic_id=topic.id, method="new_topic", decided_by=user.id))
        db.add(m.StatusHistory(topic_id=topic.id, from_status=None, to_status="backlog",
                               actor_role="system", reason="의제 생성"))
        auto_subscribe(db, user.id, topic.id)

        # Report 저장과 의제 연결이 모두 성공해야 커밋한다 (REQ-REG-11, NFR-SF04)
        db.commit()
    except IntegrityError:
        # 같은 요청이 동시에 두 번 들어와 먼저 끝난 쪽이 있으면 그 결과를 돌려준다
        db.rollback()
        for name in saved:
            delete_file(name)
        first = db.scalar(select(m.Report).where(m.Report.client_request_id == client_request_id))
        if first is None or first.author_id != user.id:
            raise
        return ReportCreated(report_id=first.id, topic_id=first.topic_id, link="new_topic")
    except Exception:
        db.rollback()
        for name in saved:
            delete_file(name)
        raise

    return ReportCreated(report_id=report.id, topic_id=topic.id, link="new_topic")


@router.get("/api/photos/{file_name}")
def get_photo(file_name: str):
    """첨부 사진. 파일 이름은 추측할 수 없는 무작위 값이다."""
    if not FILE_NAME_RE.match(file_name):
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    path = upload_dir() / file_name
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    media = "image/png" if file_name.endswith(".png") else "image/jpeg"
    return FileResponse(path, media_type=media, headers={"Cache-Control": "private, max-age=86400"})

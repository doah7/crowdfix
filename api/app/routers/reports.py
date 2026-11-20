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
from ..ai import EmbeddingError, embed, report_text, topic_text
from ..schemas import TopicSummary
from ..services import (
    auto_subscribe,
    guess_category,
    guess_floor,
    guess_room,
    participation_counts,
    report_counts,
    to_summary,
)
from ..similar import find_similar

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
    # 작성 중 추천된 기존 의제에 참여할 때 (REQ-UI-20 '이 의제에 참여')
    target_topic_id: int | None = Form(None),
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

    target: m.Topic | None = None
    if target_topic_id is not None:
        # 같은 의제에 동시에 여러 Report가 연결돼도 순서대로 처리한다
        target = db.scalar(select(m.Topic).where(m.Topic.id == target_topic_id).with_for_update())
        if target is None or target.type != "issue" or target.status == "done":
            errors["target_topic_id"] = "이 의제에는 참여할 수 없어요. 새 의제로 등록해 주세요."

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
    text = report_text(title, body)
    try:
        # 새 의제도 바로 다음 글의 추천 대상이 되도록 임베딩을 함께 저장한다 (데모 문서 구현 메모)
        vec: list[float] | None = embed([text])[0]
    except EmbeddingError:
        vec = None  # AI가 실패해도 등록은 계속한다 (REQ-REG-07)
    saved: list[str] = []
    try:
        for content, ext, content_type in cleaned:
            saved.append(save_file(content, ext))

        similarity, matched = None, None
        if target is not None:
            if vec is not None:
                # 연결 근거(유사도·일치한 속성)를 남긴다 (REQ-DB-03, REQ-SIM-08).
                # 새 Report를 저장하기 전에 계산해야 자기 자신과 비교되지 않는다.
                found = find_similar(db, building.id, text, vector=vec)
                hit = next((c for c in found.candidates if c.topic.id == target.id), None)
                if hit is not None:
                    similarity, matched = hit.similarity, {"attrs": hit.matched, "relation": hit.relation}
            topic = target
            topic.last_report_at = now
            link_method = "user_selected"
        else:
            # 사용자가 '새 의제로 등록'을 골랐거나 비슷한 의제가 없다
            summary = body if len(body) <= 120 else body[:119] + "…"
            topic = m.Topic(
                type="issue",
                title=title,
                summary=summary,
                category=guess_category(text),
                building_id=building.id,
                floor=floor_value,
                room=guess_room(text),
                status="backlog",            # 새 의제의 초기 상태 (FR-STAT-01)
                delivery_status="not_sent",
                last_report_at=now,
                embedding=embed([topic_text(title)])[0] if vec is not None else None,
            )
            db.add(topic)
            db.flush()
            link_method = "new_topic"

        report = m.Report(
            author_id=user.id,
            topic_id=topic.id,
            title=title,
            body=body,
            building_id=building.id,
            floor=floor_value,
            lang="ko",
            client_request_id=client_request_id,
            embedding=vec,
        )
        db.add(report)
        db.flush()

        for name, (content, _ext, content_type) in zip(saved, cleaned):
            db.add(m.Photo(report_id=report.id, file_name=name, content_type=content_type, size_bytes=len(content)))

        db.add(m.ReportLink(report_id=report.id, topic_id=topic.id, method=link_method, decided_by=user.id,
                            similarity=similarity, matched_attrs=matched))
        if target is None:
            db.add(m.StatusHistory(topic_id=topic.id, from_status=None, to_status="backlog",
                                   actor_role="system", reason="의제 생성"))
        # 작성자 자동 구독 (FR-NOTI-02). Report 연결만으로는 참여 인원이 늘지 않는다 (BR-03).
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
        method = db.scalar(select(m.ReportLink.method).where(m.ReportLink.report_id == first.id))
        return ReportCreated(report_id=first.id, topic_id=first.topic_id, link=method or "new_topic")
    except Exception:
        db.rollback()
        for name in saved:
            delete_file(name)
        raise

    return ReportCreated(report_id=report.id, topic_id=topic.id, link=link_method)


class SimilarIn(BaseModel):
    building_id: int
    title: str = ""
    body: str


class SimilarCandidate(BaseModel):
    topic: TopicSummary
    similarity: float
    relation: str          # same(같음) | related(관련 있음)
    matched: list[str]     # 일치한 속성


class SimilarOut(BaseModel):
    category: str | None   # 본문에서 추출한 대상
    floor: str | None
    candidates: list[SimilarCandidate]


@router.post("/api/similar", response_model=SimilarOut)
def similar(req: SimilarIn, db: Session = Depends(get_db), _user: m.User = Depends(current_user)):
    """작성 중인 글과 비슷한 의제 후보 (SRS 4.3). 등록 버튼을 누르기 전에 화면이 호출한다."""
    text = report_text(req.title, req.body)
    if len(text.strip()) < settings.similar_min_text:
        return SimilarOut(category=None, floor=None, candidates=[])
    if db.get(m.Building, req.building_id) is None:
        raise _field_errors({"building_id": "장소를 선택해 주세요."})
    try:
        found = find_similar(db, req.building_id, text)
    except EmbeddingError:
        # 실패를 '유사 의제 없음'으로 보이지 않게 구분한다 (REQ-SIM-09)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail={"type": "ai_unavailable"})
    ids = [c.topic.id for c in found.candidates]
    counts = participation_counts(db, ids)
    n_reports = report_counts(db, ids)
    return SimilarOut(
        category=found.category,
        floor=found.floor,
        candidates=[
            SimilarCandidate(
                topic=to_summary(c.topic, counts[c.topic.id], n_reports.get(c.topic.id, 0)),
                similarity=c.similarity,
                relation=c.relation,
                matched=c.matched,
            )
            for c in found.candidates
        ],
    )


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

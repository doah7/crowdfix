from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, joinedload, selectinload

from .. import models as m
from ..auth import current_user
from ..db import get_db
from ..schemas import Counts, HistoryOut, PhotoOut, ReportOut, TopicDetail, TopicSummary
from ..services import add_participation, participation_counts, report_counts, threshold_for, to_summary

router = APIRouter(prefix="/api/topics", tags=["topics"])


@router.get("", response_model=list[TopicSummary])
def list_topics(
    type: Literal["issue", "proposal"] | None = None,
    status_: list[Literal["backlog", "in_progress", "done"]] | None = Query(None, alias="status"),
    building_id: int | None = None,
    sort: Literal["latest", "participants"] = "latest",
    db: Session = Depends(get_db),
    _user: m.User = Depends(current_user),
):
    """지도 마커와 목록이 같은 조건으로 함께 바뀌도록 하나의 조회 API를 쓴다 (4.6.2 ②)."""
    q = select(m.Topic).options(joinedload(m.Topic.building))
    if type:
        q = q.where(m.Topic.type == type)
    if status_:
        q = q.where(m.Topic.status.in_(status_))
    if building_id is not None:
        q = q.where(m.Topic.building_id == building_id)
    topics = db.scalars(q).all()

    ids = [t.id for t in topics]
    counts = participation_counts(db, ids)
    n_reports = report_counts(db, ids)
    items = [to_summary(t, counts[t.id], n_reports.get(t.id, 0)) for t in topics]
    if sort == "participants":
        items.sort(key=lambda x: (x["counts"]["unique"], x["last_report_at"]), reverse=True)
    else:
        items.sort(key=lambda x: x["created_at"], reverse=True)
    return items


@router.get("/{topic_id}", response_model=TopicDetail)
def get_topic(topic_id: int, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    topic = db.scalar(
        select(m.Topic)
        .options(joinedload(m.Topic.building), selectinload(m.Topic.reports).selectinload(m.Report.photos))
        .where(m.Topic.id == topic_id)
    )
    if topic is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"type": "topic_not_found"})

    counts = participation_counts(db, [topic.id])[topic.id]
    mine = db.scalars(
        select(m.Participation.kind).where(m.Participation.topic_id == topic.id, m.Participation.user_id == user.id)
    ).all()
    sub = db.scalar(
        select(m.Subscription).where(m.Subscription.topic_id == topic.id, m.Subscription.user_id == user.id)
    )
    history = db.scalars(
        select(m.StatusHistory).where(m.StatusHistory.topic_id == topic.id).order_by(m.StatusHistory.created_at)
    ).all()

    base = to_summary(topic, counts, len(topic.reports))
    return TopicDetail(
        **base,
        result=topic.result,
        result_reason=topic.result_reason,
        threshold=threshold_for(topic.type),
        my_participations=list(mine),
        subscribed=bool(sub and sub.active),
        # 공개 화면에는 작성자 개인정보를 표시하지 않는다 (NFR-SEC06)
        reports=[
            ReportOut(
                id=r.id, title=r.title, body=r.body, created_at=r.created_at,
                is_mine=r.author_id == user.id,
                photos=[PhotoOut(id=p.id, url=f"/api/photos/{p.file_name}") for p in r.photos],
            )
            for r in sorted(topic.reports, key=lambda r: r.created_at, reverse=True)
        ],
        # 이력에는 변경 주체의 역할만 표시한다 (FR-STAT-05)
        history=[
            HistoryOut(from_status=h.from_status, to_status=h.to_status, actor_role=h.actor_role,
                       reason=h.reason, result=h.result, created_at=h.created_at)
            for h in history
        ],
    )


# ---------- 참여 (SRS 4.2, BR-02·03) ----------

KINDS_BY_TYPE = {"issue": ("experienced", "needs_improvement"), "proposal": ("want",)}
ParticipationKind = Literal["experienced", "needs_improvement", "want"]


class ParticipationState(BaseModel):
    counts: Counts
    my_participations: list[str]
    subscribed: bool


def _state(db: Session, topic: m.Topic, user: m.User) -> ParticipationState:
    counts = participation_counts(db, [topic.id])[topic.id]
    mine = db.scalars(
        select(m.Participation.kind).where(m.Participation.topic_id == topic.id, m.Participation.user_id == user.id)
    ).all()
    sub = db.scalar(
        select(m.Subscription).where(m.Subscription.topic_id == topic.id, m.Subscription.user_id == user.id)
    )
    return ParticipationState(counts=counts, my_participations=list(mine), subscribed=bool(sub and sub.active))


def _topic_or_404(db: Session, topic_id: int, lock: bool = False) -> m.Topic:
    q = select(m.Topic).where(m.Topic.id == topic_id)
    if lock:
        # 같은 의제에 대한 참여 처리를 한 줄로 세운다 (Increment 4의 1회 발송 판정 대비)
        q = q.with_for_update()
    topic = db.scalar(q)
    if topic is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"type": "topic_not_found"})
    return topic


@router.put("/{topic_id}/participations/{kind}", response_model=ParticipationState)
def participate(
    topic_id: int, kind: ParticipationKind, db: Session = Depends(get_db), user: m.User = Depends(current_user)
):
    """참여 등록. 같은 버튼을 여러 번 눌러도 한 번만 집계된다 (REQ-DB-07, NFR-Q05)."""
    topic = _topic_or_404(db, topic_id, lock=True)
    if kind not in KINDS_BY_TYPE[topic.type]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={"type": "invalid_kind"})
    add_participation(db, topic, user.id, kind)
    db.commit()
    return _state(db, topic, user)


@router.delete("/{topic_id}/participations/{kind}", response_model=ParticipationState)
def cancel_participation(
    topic_id: int, kind: ParticipationKind, db: Session = Depends(get_db), user: m.User = Depends(current_user)
):
    """참여 취소. 남은 참여 기록으로 고유 인원을 다시 센다 (BR-03). 구독은 그대로 둔다."""
    topic = _topic_or_404(db, topic_id, lock=True)
    db.execute(
        delete(m.Participation).where(
            m.Participation.topic_id == topic.id, m.Participation.user_id == user.id, m.Participation.kind == kind
        )
    )
    db.commit()
    return _state(db, topic, user)


# ---------- 구독 (SRS 4.5, FR-NOTI-01·02) ----------


@router.put("/{topic_id}/subscription", response_model=ParticipationState)
def subscribe(topic_id: int, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    topic = _topic_or_404(db, topic_id)
    db.execute(
        insert(m.Subscription)
        .values(user_id=user.id, topic_id=topic.id, active=True)
        .on_conflict_do_update(constraint="uq_subscription", set_={"active": True})
    )
    db.commit()
    return _state(db, topic, user)


@router.delete("/{topic_id}/subscription", response_model=ParticipationState)
def unsubscribe(topic_id: int, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    """명시적 해제 시각을 남겨, 이후 자동 구독 대상이 돼도 다시 구독시키지 않는다 (REQ-DB-10)."""
    topic = _topic_or_404(db, topic_id)
    now = datetime.now(timezone.utc)
    db.execute(
        insert(m.Subscription)
        .values(user_id=user.id, topic_id=topic.id, active=False, unsubscribed_at=now)
        .on_conflict_do_update(constraint="uq_subscription", set_={"active": False, "unsubscribed_at": now})
    )
    db.commit()
    return _state(db, topic, user)

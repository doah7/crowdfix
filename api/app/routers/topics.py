from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from .. import models as m
from ..auth import current_user
from ..db import get_db
from ..schemas import HistoryOut, PhotoOut, ReportOut, TopicDetail, TopicSummary
from ..services import participation_counts, report_counts, threshold_for, to_summary

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
                photos=[PhotoOut(id=p.id, url=f"/api/photos/{p.id}") for p in r.photos],
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

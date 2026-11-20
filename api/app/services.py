"""여러 라우터가 함께 쓰는 집계·변환 로직."""

from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import models as m
from .config import settings
from .schemas import BuildingRef, Counts, TopicSummary


def participation_counts(db: Session, topic_ids: list[int]) -> dict[int, Counts]:
    """유형별 참여 수와 고유 참여 인원(BR-03). 한 사람이 두 버튼을 눌러도 고유 인원은 1명."""
    result: dict[int, Counts] = defaultdict(Counts)
    if not topic_ids:
        return result
    rows = db.execute(
        select(m.Participation.topic_id, m.Participation.kind, func.count())
        .where(m.Participation.topic_id.in_(topic_ids))
        .group_by(m.Participation.topic_id, m.Participation.kind)
    )
    for topic_id, kind, n in rows:
        setattr(result[topic_id], kind, n)
    rows = db.execute(
        select(m.Participation.topic_id, func.count(func.distinct(m.Participation.user_id)))
        .where(m.Participation.topic_id.in_(topic_ids))
        .group_by(m.Participation.topic_id)
    )
    for topic_id, n in rows:
        result[topic_id].unique = n
    return result


def report_counts(db: Session, topic_ids: list[int]) -> dict[int, int]:
    if not topic_ids:
        return {}
    rows = db.execute(
        select(m.Report.topic_id, func.count())
        .where(m.Report.topic_id.in_(topic_ids))
        .group_by(m.Report.topic_id)
    )
    return dict(rows.all())


def threshold_for(topic_type: str) -> int:
    return settings.threshold_issue if topic_type == "issue" else settings.threshold_proposal


def to_summary(topic: m.Topic, counts: Counts, n_reports: int) -> dict:
    b = topic.building
    return TopicSummary(
        id=topic.id,
        type=topic.type,
        title=topic.title,
        summary=topic.summary,
        status=topic.status,
        delivery_status=topic.delivery_status,
        building=BuildingRef(id=b.id, name_ko=b.name_ko, name_en=b.name_en,
                             latitude=b.latitude, longitude=b.longitude) if b else None,
        floor=topic.floor,
        counts=counts,
        report_count=n_reports,
        last_report_at=topic.last_report_at,
        created_at=topic.created_at,
    ).model_dump()

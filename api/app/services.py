"""여러 라우터가 함께 쓰는 집계·변환 로직."""

import re
from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from . import models as m
from .config import settings
from .delivery import PendingMail, reserve_if_ready
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
        room=topic.room,
        counts=counts,
        report_count=n_reports,
        last_report_at=topic.last_report_at,
        created_at=topic.created_at,
    ).model_dump()


def auto_subscribe(db: Session, user_id: int, topic_id: int) -> None:
    """Report 작성자·참여자 자동 구독 (FR-NOTI-02).
    이미 구독 기록이 있으면(명시적으로 해제한 경우 포함) 건드리지 않는다."""
    db.execute(
        insert(m.Subscription)
        .values(user_id=user_id, topic_id=topic_id, active=True)
        .on_conflict_do_nothing(constraint="uq_subscription")
    )


# 담당 조직 연결표(org_routes)의 분류를 고르기 위한 간단한 키워드 규칙.
# 맞는 분류가 없으면 None → 자동 전달 시 '운영자 검토 중'으로 보낸다 (FR-STAT-13).
_CATEGORY_KEYWORDS = [
    ("printer", ("프린터", "출력", "인쇄", "용지", "토너", "printer", "print")),
    ("wifi", ("와이파이", "wi-fi", "wifi", "인터넷", "네트워크")),
    ("power", ("콘센트", "전원", "충전", "outlet")),
    ("hvac", ("에어컨", "냉방", "난방", "히터", "air conditioner")),
]


def guess_category(text: str) -> str | None:
    t = text.lower()
    for category, words in _CATEGORY_KEYWORDS:
        if any(w in t for w in words):
            return category
    return None


_FLOOR_RE = re.compile(r"(?<![A-Za-z0-9])(B[1-9])(?![0-9])|(?<![0-9])([1-9][0-9]?)\s*(?:F|층)(?![A-Za-z])", re.I)


def guess_floor(text: str) -> str | None:
    """본문에 'B1', '3층', '3F'가 있으면 층으로 쓴다. 사용자가 층을 직접 입력하면 그 값을 우선한다."""
    mt = _FLOOR_RE.search(text)
    if not mt:
        return None
    return mt.group(1).upper() if mt.group(1) else f"{mt.group(2)}F"


def add_participation(db: Session, topic: m.Topic, user_id: int, kind: str) -> PendingMail | None:
    """참여 등록 (같은 버튼 반복은 한 번만). 버튼을 누른 사용자는 자동 구독된다 (FR-NOTI-02).
    호출하는 쪽에서 topic 행을 잠그고(SELECT … FOR UPDATE) 커밋한다.
    잠근 상태에서 고유 인원을 다시 세어 기준에 처음 도달하면 보고서 발송을 예약해 돌려준다 (SRS 4.4.2).
    호출한 쪽은 커밋한 뒤 delivery.send_reserved()로 보낸다."""
    db.execute(
        insert(m.Participation)
        .values(user_id=user_id, topic_id=topic.id, kind=kind)
        .on_conflict_do_nothing(constraint="uq_participation")
    )
    auto_subscribe(db, user_id, topic.id)
    return reserve_if_ready(db, topic, participation_counts(db, [topic.id])[topic.id], threshold_for(topic.type))


# 강의실·호실 번호: 5~6자리 숫자(예: 26312 = 26동 3층 12호). 지하는 48B07처럼 B를 쓴다.
_ROOM_RE = re.compile(r"(?<![0-9A-Za-z])([0-9]{5,6}|[0-9]{2}B[0-9]{2,3})(?![0-9A-Za-z])", re.I)


def guess_room(text: str) -> str | None:
    mt = _ROOM_RE.search(text)
    return mt.group(1).upper() if mt else None

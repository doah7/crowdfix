"""CrowdFix 데이터 모델.

데모 전체(장면 1~5)에 필요한 테이블을 Increment 1에서 한 번에 정의한다 (SRS 2.5: 스키마 먼저 합의).
SRS 6.1 REQ-DB-01~10 을 기준으로 한다.
"""

from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .config import settings
from .db import Base

ROLES = ("student", "operator")
TOPIC_TYPES = ("issue", "proposal")
STATUSES = ("backlog", "in_progress", "done")
DELIVERY_STATUSES = ("not_sent", "sent", "failed", "review")
RESULTS = ("resolved", "closed_unresolved", "adopted", "partially_adopted", "not_adopted")
PARTICIPATION_KINDS = ("experienced", "needs_improvement", "want")
LINK_METHODS = ("new_topic", "user_selected", "ai_auto", "operator")


def _in(col: str, values: tuple[str, ...]) -> str:
    return f"{col} IN ({', '.join(repr(v) for v in values)})"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class User(TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint(_in("role", ROLES), name="ck_users_role"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    login_id: Mapped[str] = mapped_column(String(50), unique=True)
    password_hash: Mapped[str] = mapped_column(String(100))
    display_name: Mapped[str] = mapped_column(String(50))
    role: Mapped[str] = mapped_column(String(20), default="student")


class Building(Base):
    """자연과학캠퍼스 건물·장소 (TBD-11). 출처: 성균관대 캠퍼스맵."""

    __tablename__ = "buildings"

    id: Mapped[int] = mapped_column(primary_key=True)
    build_no: Mapped[str | None] = mapped_column(String(10), unique=True)
    name_ko: Mapped[str] = mapped_column(String(100))
    name_en: Mapped[str] = mapped_column(String(100))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    kind: Mapped[str] = mapped_column(String(20))  # building | place


class Topic(TimestampMixin, Base):
    """의제 (Issue 또는 Proposal)."""

    __tablename__ = "topics"
    __table_args__ = (
        CheckConstraint(_in("type", TOPIC_TYPES), name="ck_topics_type"),
        CheckConstraint(_in("status", STATUSES), name="ck_topics_status"),
        CheckConstraint(_in("delivery_status", DELIVERY_STATUSES), name="ck_topics_delivery"),
        CheckConstraint(f"result IS NULL OR {_in('result', RESULTS)}", name="ck_topics_result"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(200))
    summary: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str | None] = mapped_column(String(50))  # 담당 조직 연결표 매칭용
    building_id: Mapped[int | None] = mapped_column(ForeignKey("buildings.id"))
    floor: Mapped[str | None] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(20), default="backlog")
    delivery_status: Mapped[str] = mapped_column(String(20), default="not_sent")
    result: Mapped[str | None] = mapped_column(String(30))
    result_reason: Mapped[str | None] = mapped_column(Text)
    embedding = mapped_column(Vector(settings.embedding_dim), nullable=True)
    last_report_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    building: Mapped[Building | None] = relationship()
    reports: Mapped[list["Report"]] = relationship(back_populates="topic", order_by="Report.created_at")


class Report(TimestampMixin, Base):
    """개별 글. 원문은 연결·분리 후에도 보존한다 (REQ-DB-02)."""

    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    topic_id: Mapped[int | None] = mapped_column(ForeignKey("topics.id"))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    building_id: Mapped[int | None] = mapped_column(ForeignKey("buildings.id"))
    floor: Mapped[str | None] = mapped_column(String(30))
    lang: Mapped[str] = mapped_column(String(5), default="ko")  # REQ-DB-09
    # 같은 등록 요청이 재전송돼도 중복 생성하지 않기 위한 키 (REQ-REG-12)
    client_request_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    embedding = mapped_column(Vector(settings.embedding_dim), nullable=True)

    author: Mapped[User] = relationship()
    topic: Mapped[Topic | None] = relationship(back_populates="reports")
    photos: Mapped[list["Photo"]] = relationship(back_populates="report")


class ReportLink(TimestampMixin, Base):
    """Report–의제 연결 이력과 근거 (REQ-DB-03, REQ-SIM-08)."""

    __tablename__ = "report_links"
    __table_args__ = (CheckConstraint(_in("method", LINK_METHODS), name="ck_links_method"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("reports.id"))
    topic_id: Mapped[int] = mapped_column(ForeignKey("topics.id"))
    method: Mapped[str] = mapped_column(String(20))
    similarity: Mapped[float | None] = mapped_column(Float)
    matched_attrs: Mapped[dict | None] = mapped_column(JSON)
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))


class Photo(TimestampMixin, Base):
    """Report 첨부 사진. 파일은 Docker 볼륨(uploads)에 저장하고 GPS 정보는 제거한다 (TBD-09)."""

    __tablename__ = "photos"

    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("reports.id"))
    file_name: Mapped[str] = mapped_column(String(200))
    content_type: Mapped[str] = mapped_column(String(50))
    size_bytes: Mapped[int] = mapped_column(Integer)

    report: Mapped[Report] = relationship(back_populates="photos")


class Participation(TimestampMixin, Base):
    """공감 참여. (사용자, 의제, 유형) 조합은 한 번만 (REQ-DB-07, BR-03)."""

    __tablename__ = "participations"
    __table_args__ = (
        UniqueConstraint("user_id", "topic_id", "kind", name="uq_participation"),
        CheckConstraint(_in("kind", PARTICIPATION_KINDS), name="ck_participation_kind"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    topic_id: Mapped[int] = mapped_column(ForeignKey("topics.id"), index=True)
    kind: Mapped[str] = mapped_column(String(30))


class Subscription(TimestampMixin, Base):
    """구독과 명시적 해제 이력 (REQ-DB-10, FR-NOTI-02)."""

    __tablename__ = "subscriptions"
    __table_args__ = (UniqueConstraint("user_id", "topic_id", name="uq_subscription"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    topic_id: Mapped[int] = mapped_column(ForeignKey("topics.id"), index=True)
    active: Mapped[bool] = mapped_column(default=True)
    unsubscribed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class StatusHistory(TimestampMixin, Base):
    """처리 상태 변경 이력. 수정·삭제하지 않는다 (FR-STAT-04, REQ-DB-04)."""

    __tablename__ = "status_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    topic_id: Mapped[int] = mapped_column(ForeignKey("topics.id"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(20))
    to_status: Mapped[str] = mapped_column(String(20))
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    actor_role: Mapped[str] = mapped_column(String(20))
    reason: Mapped[str | None] = mapped_column(Text)
    result: Mapped[str | None] = mapped_column(String(30))


class OrgRoute(Base):
    """담당 조직 연결표 (AS-02, TBD-03). 시연에서는 시험 수신함 주소를 쓴다."""

    __tablename__ = "org_routes"

    id: Mapped[int] = mapped_column(primary_key=True)
    category: Mapped[str] = mapped_column(String(50), unique=True)
    org_name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(200))


class Delivery(TimestampMixin, Base):
    """보고서 발송 기록 (FR-STAT-12, REQ-DB-05)."""

    __tablename__ = "deliveries"

    id: Mapped[int] = mapped_column(primary_key=True)
    topic_id: Mapped[int] = mapped_column(ForeignKey("topics.id"), index=True)
    org_name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(200))
    trigger: Mapped[str] = mapped_column(String(20))  # auto | manual
    result: Mapped[str] = mapped_column(String(20))  # accepted | rejected | no_response
    error: Mapped[str | None] = mapped_column(Text)


class Notification(TimestampMixin, Base):
    """알림함 항목 (FR-NOTI-03~07)."""

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    topic_id: Mapped[int] = mapped_column(ForeignKey("topics.id"))
    event: Mapped[str] = mapped_column(String(30))  # status_changed | result_published | delivered | relinked
    summary: Mapped[str] = mapped_column(Text)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

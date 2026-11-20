from datetime import datetime

from pydantic import BaseModel


class LoginIn(BaseModel):
    login_id: str
    password: str


class UserOut(BaseModel):
    id: int
    login_id: str
    display_name: str
    role: str


class LoginOut(BaseModel):
    token: str
    user: UserOut


class BuildingOut(BaseModel):
    id: int
    build_no: str | None
    name_ko: str
    name_en: str
    latitude: float
    longitude: float
    kind: str
    topic_count: int = 0


class Counts(BaseModel):
    experienced: int = 0         # 나도 겪었어요 (Issue)
    needs_improvement: int = 0   # 개선이 필요해요 (Issue)
    want: int = 0                # 나도 원해요 (Proposal)
    unique: int = 0              # 고유 참여 인원 (BR-03)


class BuildingRef(BaseModel):
    id: int
    name_ko: str
    name_en: str
    latitude: float
    longitude: float


class TopicSummary(BaseModel):
    id: int
    type: str
    title: str
    summary: str
    status: str
    delivery_status: str
    building: BuildingRef | None
    floor: str | None
    room: str | None = None
    counts: Counts
    report_count: int
    last_report_at: datetime
    created_at: datetime
    # 로그인한 사용자가 누른 참여 버튼 (목록 카드의 버튼 표시용)
    my_participations: list[str] = []


class PhotoOut(BaseModel):
    id: int
    url: str


class ReportOut(BaseModel):
    id: int
    title: str
    body: str
    created_at: datetime
    is_mine: bool
    photos: list[PhotoOut]


class HistoryOut(BaseModel):
    from_status: str | None
    to_status: str
    actor_role: str
    reason: str | None
    result: str | None
    created_at: datetime


class TopicDetail(TopicSummary):
    result: str | None
    result_reason: str | None
    threshold: int
    my_participations: list[str]
    subscribed: bool
    reports: list[ReportOut]
    history: list[HistoryOut]

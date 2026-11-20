"""시연 데이터 초기화 스크립트 (데모 문서 2.4, 사전 준비).

    python -m app.seed            # 모든 데이터를 지우고 시연 시작 상태로 되돌린다
    python -m app.seed --if-empty # DB가 비어 있을 때만 채운다 (컨테이너 시작 시 자동 실행)

docker compose 환경에서는:  docker compose exec api python -m app.seed
"""

import argparse
import csv
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from . import models as m
from .auth import hash_password
from .config import settings
from .db import Base, SessionLocal, engine

DEMO_PASSWORD = "demo1234"

# (login_id, 표시 이름, 역할)
DEMO_ACCOUNTS = [
    ("studentA", "학생 A", "student"),
    ("studentB", "학생 B", "student"),
    ("seedC1", "학생 C1", "student"),
    ("operator", "운영자", "operator"),
]
# 시드 의제의 기존 참여자 (화면 밖 학생들)
EXTRA_SEED_USERS = [(f"seed{i:02d}", f"재학생 {i:02d}", "student") for i in range(1, 11)]

ORG_ROUTES = [
    ("printer", "학술정보관 정보운영팀", "library-it@demo.local"),
    ("wifi", "정보통신처", "ict@demo.local"),
    ("power", "시설관리팀", "facility@demo.local"),
    ("hvac", "시설관리팀", "facility@demo.local"),
    ("academic", "학사지원팀", "academic@demo.local"),
    ("event", "학생지원팀", "student-affairs@demo.local"),
]

NOW = datetime.now(timezone.utc)


def ago(days: float = 0, hours: float = 0) -> datetime:
    return NOW - timedelta(days=days, hours=hours)


# 시드 의제 (데모 문서 2.4). 메인 의제(디도 B1 프린터)는 넣지 않는다 — 장면 1에서 학생 A가 등록한다.
# 참여 인원이 T(3) 이상인 의제는 이미 '전달 완료' 상태로 넣어 시연 중 다른 메일이 나가지 않게 한다.
SEED_TOPICS = [
    {
        "type": "issue",
        "build_no": "248",
        "floor": "B1",
        "category": "wifi",
        "title": "디도 B1 Wi-Fi가 자주 끊겨요",
        "summary": "삼성학술정보관 지하 1층에서 Wi-Fi 연결이 수시로 끊김",
        "status": "in_progress",
        "delivery_status": "sent",
        "created": ago(days=9),
        "reports": [
            ("seed01", "B1 와이파이 끊김", "디도 지하 1층 열람석에서 와이파이가 10분마다 끊겨요. 재접속해도 금방 다시 끊깁니다.", ago(days=9)),
            ("seed04", "지하 와이파이 불안정", "B1 그룹스터디룸 쪽 Wi-Fi가 계속 끊겨서 온라인 강의를 못 들었어요.", ago(days=6)),
        ],
        "participations": {
            "experienced": ["seed01", "seed02", "seed03", "seed04", "seed05"],
            "needs_improvement": ["seed01", "seed06", "seed07"],
        },
        "history": [("backlog", "in_progress", "정보통신처 확인 중", None, ago(days=5))],
    },
    {
        "type": "issue",
        "build_no": "248",
        "floor": "3F",
        "category": "power",
        "title": "3층 열람실 콘센트가 작동하지 않아요",
        "summary": "삼성학술정보관 3층 열람실 창가 쪽 콘센트 전원 불량",
        "status": "done",
        "delivery_status": "sent",
        "result": "resolved",
        "result_reason": "콘센트 교체 완료",
        "created": ago(days=20),
        "reports": [
            ("seed02", "3층 콘센트 고장", "3층 열람실 창가 자리 콘센트에 충전기를 꽂아도 전원이 안 들어와요.", ago(days=20)),
        ],
        "participations": {
            "experienced": ["seed02", "seed03", "seed08"],
            "needs_improvement": ["seed09"],
        },
        "history": [
            ("backlog", "in_progress", "시설관리팀 확인 중", None, ago(days=15)),
            ("in_progress", "done", "콘센트 교체 완료", "resolved", ago(days=11)),
        ],
    },
    {
        "type": "issue",
        "build_no": "221",
        "floor": "1F",
        "category": "printer",
        "title": "21동 프린터 출력이 안 돼요",
        "summary": "제1공학관21동 1층 학생용 프린터 출력 장애",
        "status": "backlog",
        "delivery_status": "not_sent",
        "created": ago(days=2),
        "reports": [
            ("seed08", "21동 프린터 고장", "제1공학관 21동 1층 프린터에서 인쇄를 눌러도 아무것도 안 나와요.", ago(days=2)),
        ],
        # 2명 이하로 둔다 (데모 문서 2.4)
        "participations": {"experienced": ["seed08"], "needs_improvement": ["seed09"]},
        "history": [],
    },
    {
        "type": "issue",
        "build_no": "226",
        "floor": "2F",
        "category": "hvac",
        "title": "26동 강의실 에어컨이 작동하지 않아요",
        "summary": "제2공학관26동 2층 강의실 냉방 불가",
        "status": "in_progress",
        "delivery_status": "sent",
        "created": ago(days=7),
        "reports": [
            ("seed05", "26동 에어컨 미작동", "26동 2층 강의실 에어컨 리모컨을 눌러도 바람이 안 나와요. 수업 중에 너무 더워요.", ago(days=7)),
            ("seed10", "강의실 냉방 안 됨", "26동 강의실 에어컨이 며칠째 꺼져 있어요.", ago(days=4)),
        ],
        "participations": {
            "experienced": ["seed05", "seed06", "seed10"],
            "needs_improvement": ["seed07", "seed03"],
        },
        "history": [("backlog", "in_progress", "시설관리팀 점검 일정 조율 중", None, ago(days=3))],
    },
    {
        "type": "proposal",
        "build_no": None,
        "floor": None,
        "category": "academic",
        "title": "학점포기제도 개선",
        "summary": "학점포기 신청 기간과 대상 과목 범위를 넓혀 달라는 제안",
        "status": "backlog",
        "delivery_status": "sent",
        "created": ago(days=12),
        "reports": [
            ("seed03", "학점포기 기간 연장", "학점포기 신청 기간이 너무 짧아요. 성적 공개 후 일주일은 신청할 수 있게 해 주세요.", ago(days=12)),
        ],
        "participations": {"want": ["seed01", "seed02", "seed03", "seed04", "seed05", "seed06", "seed07", "seed08", "seed09"]},
        "history": [],
    },
    {
        "type": "proposal",
        "build_no": None,
        "floor": None,
        "category": "event",
        "title": "축제 부스 확대 제안",
        "summary": "축제 기간 학생 동아리·학과 부스 수를 늘려 달라는 제안",
        "status": "backlog",
        "delivery_status": "sent",
        "created": ago(days=5),
        "reports": [
            ("seed06", "축제 부스 늘려 주세요", "부스 신청 경쟁이 너무 치열해요. 킹고광장 쪽에도 부스 자리를 만들어 주세요.", ago(days=5)),
        ],
        "participations": {"want": ["seed02", "seed04", "seed06", "seed08", "seed09", "seed10"]},
        "history": [],
    },
]


def create_schema() -> None:
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        # 유사도 검색용 벡터 인덱스 (REQ-DB-06)
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_topics_embedding ON topics USING hnsw (embedding vector_cosine_ops)"
        ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_reports_embedding ON reports USING hnsw (embedding vector_cosine_ops)"
        ))


def drop_schema() -> None:
    Base.metadata.drop_all(engine)


def load_buildings(db: Session) -> int:
    path = Path(settings.buildings_csv)
    with path.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        db.add(m.Building(
            build_no=r["build_no"].strip() or None,
            name_ko=r["name_ko"].strip(),
            name_en=r["name_en"].strip(),
            latitude=float(r["latitude"]),
            longitude=float(r["longitude"]),
            kind=r["kind"].strip(),
        ))
    db.flush()
    return len(rows)


def seed(db: Session) -> None:
    n_buildings = load_buildings(db)

    pw = hash_password(DEMO_PASSWORD)
    users: dict[str, m.User] = {}
    for login_id, name, role in DEMO_ACCOUNTS + EXTRA_SEED_USERS:
        u = m.User(login_id=login_id, display_name=name, role=role, password_hash=pw)
        db.add(u)
        users[login_id] = u
    db.flush()

    for category, org, email in ORG_ROUTES:
        db.add(m.OrgRoute(category=category, org_name=org, email=email))

    buildings = {b.build_no: b for b in db.scalars(select(m.Building)) if b.build_no}
    routes = {category: (org, email) for category, org, email in ORG_ROUTES}
    operator = users["operator"]

    for spec in SEED_TOPICS:
        b = buildings[spec["build_no"]] if spec["build_no"] else None
        topic = m.Topic(
            type=spec["type"],
            title=spec["title"],
            summary=spec["summary"],
            category=spec["category"],
            building_id=b.id if b else None,
            floor=spec["floor"],
            status=spec["status"],
            delivery_status=spec["delivery_status"],
            result=spec.get("result"),
            result_reason=spec.get("result_reason"),
            created_at=spec["created"],
            last_report_at=max(r[3] for r in spec["reports"]),
        )
        db.add(topic)
        db.flush()

        subscribers: set[int] = set()
        for author, title, body, created in spec["reports"]:
            report = m.Report(
                author_id=users[author].id,
                topic_id=topic.id,
                title=title,
                body=body,
                building_id=topic.building_id,
                floor=topic.floor,
                lang="ko",
                created_at=created,
            )
            db.add(report)
            db.flush()
            db.add(m.ReportLink(report_id=report.id, topic_id=topic.id, method="new_topic", created_at=created))
            subscribers.add(users[author].id)

        for kind, who in spec["participations"].items():
            for login_id in who:
                db.add(m.Participation(user_id=users[login_id].id, topic_id=topic.id, kind=kind,
                                       created_at=spec["created"]))
                subscribers.add(users[login_id].id)

        for uid in subscribers:
            db.add(m.Subscription(user_id=uid, topic_id=topic.id, active=True))

        db.add(m.StatusHistory(topic_id=topic.id, from_status=None, to_status="backlog",
                               actor_role="system", reason="의제 생성", created_at=spec["created"]))
        for from_s, to_s, reason, result, at in spec["history"]:
            db.add(m.StatusHistory(topic_id=topic.id, from_status=from_s, to_status=to_s,
                                   actor_id=operator.id, actor_role="operator",
                                   reason=reason, result=result, created_at=at))

        if spec["delivery_status"] == "sent":
            org, email = routes[spec["category"]]
            db.add(m.Delivery(topic_id=topic.id, org_name=org, email=email, trigger="auto",
                              result="accepted", created_at=spec["created"] + timedelta(days=1)))

    db.commit()
    print(f"[seed] 건물·장소 {n_buildings}곳, 계정 {len(users)}개, 시드 의제 {len(SEED_TOPICS)}건을 넣었습니다.")


def clear_uploads() -> None:
    up = Path(settings.upload_dir)
    if up.exists():
        for child in up.iterdir():
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()


def main() -> None:
    parser = argparse.ArgumentParser(description="CrowdFix 시연 데이터 초기화")
    parser.add_argument("--if-empty", action="store_true", help="DB가 비어 있을 때만 채운다")
    args = parser.parse_args()

    if args.if_empty:
        has_users = inspect(engine).has_table("users")
        create_schema()
        if has_users:
            with SessionLocal() as db:
                if db.scalar(select(m.User.id).limit(1)) is not None:
                    print("[seed] 기존 데이터가 있어 초기화를 건너뜁니다.")
                    return
    else:
        drop_schema()
        create_schema()
        clear_uploads()

    with SessionLocal() as db:
        seed(db)


if __name__ == "__main__":
    main()

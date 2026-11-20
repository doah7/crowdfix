"""시연 진행 보조 명령.

    docker compose exec api python -m app.demo c1-join

장면 1과 2 사이에 시드 계정 C1이 화면 밖에서 메인 의제(학생 A가 등록한 디도 프린터 의제)에
'나도 겪었어요'로 참여한다 (데모 문서 2.3·2.4). 화면의 버튼과 같은 함수를 쓴다.
"""

import argparse

from sqlalchemy import select

from . import models as m
from .db import SessionLocal
from .services import add_participation, participation_counts


def c1_join() -> None:
    with SessionLocal() as db:
        c1 = db.scalar(select(m.User).where(m.User.login_id == "seedC1"))
        a = db.scalar(select(m.User).where(m.User.login_id == "studentA"))
        if c1 is None or a is None:
            raise SystemExit("시연 계정이 없습니다. 먼저 python -m app.seed 를 실행하세요.")
        # 학생 A가 등록한 가장 최근 의제 = 장면 1의 메인 의제
        topic = db.scalar(
            select(m.Topic)
            .join(m.Report, m.Report.topic_id == m.Topic.id)
            .where(m.Report.author_id == a.id)
            .order_by(m.Topic.created_at.desc())
            .limit(1)
            .with_for_update(of=m.Topic)
        )
        if topic is None:
            raise SystemExit("학생 A가 등록한 의제가 없습니다. 장면 1을 먼저 진행하세요.")
        add_participation(db, topic, c1.id, "experienced")
        db.commit()
        c = participation_counts(db, [topic.id])[topic.id]
        print(f"[demo] C1이 '{topic.title}'에 참여했습니다. 고유 참여 {c.unique}명")


def main() -> None:
    parser = argparse.ArgumentParser(description="CrowdFix 시연 보조")
    parser.add_argument("command", choices=["c1-join"])
    args = parser.parse_args()
    if args.command == "c1-join":
        c1_join()


if __name__ == "__main__":
    main()

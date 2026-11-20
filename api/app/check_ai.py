"""AI 유사 의제 추천 점검 (데모 문서 5장 'AI 테스트 문장').

    docker compose exec api python -m app.check_ai

시연 데이터를 초기화하고, 학생 A의 메인 의제("디도 B1 프린터에서 출력이 안 돼요")를 등록한 뒤
테스트 문장마다 1순위 추천이 기대와 맞는지 확인한다. 끝나면 다시 시연 시작 상태로 초기화한다.
판정 기준(config.py의 similar_*)을 바꿨을 때 이 점검을 다시 돌린다.
"""

import sys

from sqlalchemy import select

from . import models as m
from .ai import embed, report_text, topic_text
from .db import SessionLocal
from .seed import main as reset_demo
from .similar import find_similar

MAIN = "디도 B1 프린터에서 출력이 안 돼요"

# (입력 문장, 건물 번호, 1순위로 기대하는 의제 제목 / None이면 후보 없음)
CASES = [
    ("디도 지하 프린터에서 용지 걸림 오류 화면이 떠요", "248", MAIN),
    ("B1 프린터 출력 안 돼요", "248", MAIN),
    ("제1공학관 프린터 토너가 부족해요", "221", "21동 프린터 출력이 안 돼요"),
    ("디도 B1 와이파이가 자꾸 끊겨요", "248", "B1 Wi-Fi가 자주 끊겨요"),
    # 추가 점검: 관계없는 문장은 추천하지 않는다
    ("열람실 의자가 부서졌어요", "248", None),
    ("엘리베이터가 2층에서 멈췄어요", "248", None),
]


def create_main_topic(db) -> None:
    a = db.scalar(select(m.User).where(m.User.login_id == "studentA"))
    b = db.scalar(select(m.Building).where(m.Building.build_no == "248"))
    vec = embed([report_text("", MAIN)])[0]
    t = m.Topic(type="issue", title=MAIN, summary=MAIN, category="printer", building_id=b.id, floor="B1",
                embedding=embed([topic_text(MAIN)])[0])
    db.add(t)
    db.flush()
    db.add(m.Report(author_id=a.id, topic_id=t.id, title=MAIN, body=MAIN, building_id=b.id, embedding=vec))
    db.commit()


def run() -> int:
    sys.argv = ["seed"]
    reset_demo()
    failed = 0
    with SessionLocal() as db:
        create_main_topic(db)
        buildings = {b.build_no: b.id for b in db.scalars(select(m.Building)) if b.build_no}
        for text, bno, expect in CASES:
            r = find_similar(db, buildings[bno], text)
            top = r.candidates[0] if r.candidates else None
            got = top.topic.title if top else None
            ok = got == expect
            failed += not ok
            detail = f"{got} (유사도 {top.similarity}, {top.relation})" if top else "후보 없음"
            print(f"{'PASS' if ok else 'FAIL'}  {text}\n      → {detail}" + ("" if ok else f"\n      기대: {expect}"))
    reset_demo()
    print(f"\n{len(CASES) - failed}/{len(CASES)} 통과")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(run())

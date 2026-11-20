"""유사 의제 후보 검색과 관계 판정 (SRS 4.3, BR-05, TBD-06).

1. 선택한 건물로 후보를 먼저 거른다 (데모 문서 구현 메모). 다른 건물의 의제는 비교하지 않는다.
2. 후보 의제(제목)와, 그 의제에 연결된 Report들의 임베딩과 코사인 유사도를 구해 가장 높은 값을 쓴다.
3. 본문에서 추출한 속성(대상 분류·층·강의실 번호)을 비교한다. 강의실 번호가 양쪽에 있으면 같아야 한다. 대상이 서로 다르면(예: 프린터 ↔ Wi-Fi)
   유사도가 높아도 '별개'로 보고 추천하지 않는다 (REQ-SIM-05: 핵심 정보 충돌 시 연결 안 함).
4. 남은 후보를 '같음' / '관련 있음'으로 나눠 보여 주고, 연결은 사용자가 고른다.
"""

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from . import models as m
from .ai import embed
from .config import settings
from .services import guess_category, guess_floor, guess_room

CATEGORY_LABEL = {"printer": "프린터", "wifi": "Wi-Fi", "power": "콘센트·전원", "hvac": "냉난방"}


@dataclass
class Candidate:
    topic: m.Topic
    similarity: float
    relation: str  # same | related
    matched: list[str] = field(default_factory=list)


@dataclass
class SearchResult:
    category: str | None
    floor: str | None
    candidates: list[Candidate]
    vector: list[float]


def find_similar(db: Session, building_id: int, text: str, vector: list[float] | None = None) -> SearchResult:
    category = guess_category(text)
    floor = guess_floor(text)
    room = guess_room(text)
    vec = vector if vector is not None else embed([text])[0]

    topics = db.scalars(
        select(m.Topic)
        .options(joinedload(m.Topic.building))
        .where(
            m.Topic.building_id == building_id,
            m.Topic.type == "issue",
            # 결과가 공개된(Done) 의제에 대한 추가 제보·재발 판단은 TBD-15로 미결이라 후보에서 뺀다
            m.Topic.status != "done",
        )
    ).all()
    if not topics:
        return SearchResult(category, floor, [], vec)

    ids = [t.id for t in topics]
    best: dict[int, float] = {}
    rows = db.execute(
        select(m.Topic.id, 1 - m.Topic.embedding.cosine_distance(vec))
        .where(m.Topic.id.in_(ids), m.Topic.embedding.is_not(None))
    )
    for tid, sim in rows:
        best[tid] = max(best.get(tid, -1.0), float(sim))
    rows = db.execute(
        select(m.Report.topic_id, 1 - m.Report.embedding.cosine_distance(vec))
        .where(m.Report.topic_id.in_(ids), m.Report.embedding.is_not(None))
    )
    for tid, sim in rows:
        best[tid] = max(best.get(tid, -1.0), float(sim))

    out: list[Candidate] = []
    for t in topics:
        sim = best.get(t.id)
        if sim is None:
            continue
        if category and t.category and category != t.category:
            continue  # 대상이 다르면 별개
        # 글과 의제 모두 강의실 번호가 있으면 번호가 같아야 같은 장소로 본다 (예: 26312 ≠ 26208)
        if room and t.room and room != t.room:
            continue
        matched = ["건물"]
        same_target = bool(category and t.category == category)
        if same_target:
            matched.append(f"대상({CATEGORY_LABEL.get(category, category)})")
        if room and t.room == room:
            matched.append(f"강의실({room})")
        elif floor and t.floor and floor == t.floor:
            matched.append(f"층({floor})")

        same_cut, related_cut = (
            (settings.similar_same_target, settings.similar_related_target)
            if same_target
            else (settings.similar_same, settings.similar_related)
        )
        if sim >= same_cut:
            relation = "same"
        elif sim >= related_cut:
            relation = "related"
        else:
            continue
        out.append(Candidate(t, round(sim, 3), relation, matched))

    out.sort(key=lambda c: (c.relation != "same", -c.similarity))
    return SearchResult(category, floor, out[: settings.similar_max_candidates], vec)

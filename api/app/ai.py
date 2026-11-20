"""문장 임베딩 (SRS 2.4: Sentence Transformers 기반 한국어·영어 지원 모델).

모델은 서버 시작 시 한 번 미리 올려 두고(main.py lifespan), 이후 요청에서 재사용한다.
"""

import threading

from .config import settings

_model = None
_lock = threading.Lock()


class EmbeddingError(RuntimeError):
    pass


def get_model():
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                from sentence_transformers import SentenceTransformer

                _model = SentenceTransformer(settings.embedding_model, device="cpu")
    return _model


def embed(texts: list[str]) -> list[list[float]]:
    """정규화된 임베딩 벡터(코사인 유사도 = 내적)."""
    try:
        vecs = get_model().encode(texts, normalize_embeddings=True, convert_to_numpy=True)
    except Exception as e:  # 모델 로드·추론 실패는 '유사 의제 없음'과 구분해 알린다 (REQ-SIM-09)
        raise EmbeddingError(str(e)) from e
    return [v.tolist() for v in vecs]


def report_text(title: str, body: str) -> str:
    title, body = title.strip(), body.strip()
    if not title or body.startswith(title):
        return body
    return f"{title}\n{body}"


def topic_text(title: str) -> str:
    """의제는 제목으로 비교한다. 자세한 내용은 연결된 Report들의 임베딩이 맡는다."""
    return title.strip()

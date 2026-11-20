import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .ai import embed
from .routers import auth, buildings, notifications, reports, topics

log = logging.getLogger("crowdfix")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # 임베딩 모델을 서버 시작 때 미리 올려, 첫 추천 요청이 느리지 않게 한다 (데모 문서 구현 메모)
    try:
        embed(["모델 미리 불러오기"])
        log.warning("[ai] 임베딩 모델 준비 완료")
    except Exception as e:  # 모델이 없어도 서버는 뜨고, 추천 API만 실패를 알린다
        log.error("[ai] 임베딩 모델을 불러오지 못했습니다: %s", e)
    yield


app = FastAPI(
    title="CrowdFix API",
    description="캠퍼스 의견 수집·전달 플랫폼 CrowdFix 시연용 API (Team 13)",
    version="0.3.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

app.include_router(auth.router)
app.include_router(buildings.router)
app.include_router(topics.router)
app.include_router(notifications.router)
app.include_router(reports.router)


@app.get("/api/health", tags=["meta"])
def health():
    return {"ok": True}

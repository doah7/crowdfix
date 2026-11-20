from fastapi import FastAPI

from .routers import auth, buildings, notifications, topics

app = FastAPI(
    title="CrowdFix API",
    description="캠퍼스 의견 수집·전달 플랫폼 CrowdFix 시연용 API (Team 13)",
    version="0.1.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.include_router(auth.router)
app.include_router(buildings.router)
app.include_router(topics.router)
app.include_router(notifications.router)


@app.get("/api/health", tags=["meta"])
def health():
    return {"ok": True}

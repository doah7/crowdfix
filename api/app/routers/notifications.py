from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import current_user
from ..db import get_db
from ..models import Notification, Topic, User

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("/unread-count")
def unread_count(db: Session = Depends(get_db), user: User = Depends(current_user)):
    """상단 공통 영역의 안 읽은 알림 개수 (REQ-UI-02)."""
    n = db.scalar(
        select(func.count()).select_from(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
    )
    return {"unread": n or 0}


class NotificationOut(BaseModel):
    id: int
    topic_id: int
    topic_title: str
    event: str
    summary: str
    read: bool
    created_at: datetime


@router.get("", response_model=list[NotificationOut])
def inbox(db: Session = Depends(get_db), user: User = Depends(current_user)):
    """알림함: 최근 알림부터 (FR-NOTI-05)."""
    rows = db.execute(
        select(Notification, Topic.title).join(Topic, Topic.id == Notification.topic_id)
        .where(Notification.user_id == user.id).order_by(Notification.id.desc()).limit(50)
    )
    return [
        NotificationOut(id=n.id, topic_id=n.topic_id, topic_title=title, event=n.event,
                        summary=n.summary, read=n.read_at is not None, created_at=n.created_at)
        for n, title in rows
    ]


@router.put("/{notification_id}/read")
def mark_read(notification_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    n = db.get(Notification, notification_id)
    if n is None or n.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if n.read_at is None:
        n.read_at = datetime.now(timezone.utc)
        db.commit()
    return {"read": True}

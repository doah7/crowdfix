from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import create_token, current_user, verify_password
from ..db import get_db
from ..models import User
from ..schemas import LoginIn, LoginOut, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _out(u: User) -> UserOut:
    return UserOut(id=u.id, login_id=u.login_id, display_name=u.display_name, role=u.role)


@router.post("/login", response_model=LoginOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    if not body.login_id.strip() or not body.password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={"type": "missing_credentials"})
    user = db.scalar(select(User).where(User.login_id == body.login_id.strip()))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail={"type": "invalid_credentials"})
    return LoginOut(token=create_token(user), user=_out(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return _out(user)

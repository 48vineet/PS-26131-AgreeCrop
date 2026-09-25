from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from datetime import datetime, timezone
from models_db import NotificationRead, User
from notifications import notifications_for
from translation import current_language, translate_fields

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
def list_notifications(request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    payload = notifications_for(db, current_user)
    lang = current_language(request, current_user)
    if lang == 'en':
        return payload
    # Per item, so one item falling back does not mark the whole feed as
    # translated. `kind`, `read` and timestamps are internal values and are
    # never in the key list.
    for item in payload.get("notifications", []):
        translate_fields(item, 'en', lang, ("title", "body"))
    return payload


@router.patch("/{kind}")
def mark_notification_read(kind: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    available = {item["kind"] for item in notifications_for(db, current_user)["notifications"]}
    if kind not in available:
        raise HTTPException(404, "Notification not found")
    read = db.query(NotificationRead).filter(NotificationRead.user_id == current_user.id, NotificationRead.kind == kind).first()
    if read is None:
        read = NotificationRead(user_id=current_user.id, kind=kind, read_at=datetime.now(timezone.utc).replace(tzinfo=None))
        db.add(read)
    else:
        read.read_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    return {"kind": kind, "read": True, "read_state": "database"}

"""Authenticated collection-session routes."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from auth import get_current_user
from collection_sessions import issue_collection_token
from database import get_db
from disease_observations import resolve_context
from models_db import User
from schemas import CollectionStartIn

router = APIRouter(prefix='/collections', tags=['collection sessions'])


@router.post('', status_code=201)
def start_collection(
    request: CollectionStartIn | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Start one explicit physical collection event for the caller."""
    farm_id, crop_id = resolve_context(
        db,
        current_user,
        request.farm_id if request else None,
        request.crop_id if request else None,
    )
    token, expires_at = issue_collection_token(current_user, farm_id, crop_id)
    return {
        'collection_id': token,
        'expires_at': expires_at.isoformat(),
    }

"""Short-lived, server-issued collection-session tokens.

No collection table is needed for the minimal flow. The token is authenticated
and encrypted with a backend-only key, and carries the user/context binding plus
an opaque random group identifier that is persisted on each observation.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
from datetime import datetime, timedelta, timezone

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

from models_db import User


DEFAULT_TTL_SECONDS = 30 * 60
MAX_TTL_SECONDS = 24 * 60 * 60
TOKEN_VERSION = 1
_PROCESS_SECRET = secrets.token_bytes(32)


def _ttl_seconds() -> int:
    raw = os.getenv('COLLECTION_SESSION_TTL_SECONDS')
    if raw is None:
        return DEFAULT_TTL_SECONDS
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_TTL_SECONDS
    return max(60, min(value, MAX_TTL_SECONDS))


def _fernet() -> Fernet:
    # A deployment should set COLLECTION_SESSION_SECRET. The existing server-only
    # Supabase JWT secret or database URL are stable fallbacks; the final process
    # secret keeps local development usable while making tokens expire on restart.
    raw = (
        os.getenv('COLLECTION_SESSION_SECRET')
        or os.getenv('SUPABASE_JWT_SECRET')
        or os.getenv('DATABASE_URL')
    )
    material = raw.encode('utf-8') if raw else _PROCESS_SECRET
    key = base64.urlsafe_b64encode(hashlib.sha256(material).digest())
    return Fernet(key)


def _invalid_token() -> HTTPException:
    # Do not distinguish malformed, expired, or another user's token.
    return HTTPException(404, 'Collection not found')


def issue_collection_token(
    user: User,
    farm_id: int | None = None,
    crop_id: int | None = None,
) -> tuple[str, datetime]:
    """Issue an opaque token and its expiry for one explicit collection event."""
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=_ttl_seconds())
    payload = {
        'v': TOKEN_VERSION,
        'group': secrets.token_urlsafe(32),
        'uid': int(user.id),
        'farm_id': farm_id,
        'crop_id': crop_id,
        'exp': int(expires_at.timestamp()),
    }
    token = _fernet().encrypt(json.dumps(payload, separators=(',', ':')).encode())
    return token.decode('ascii'), expires_at


def resolve_collection_token(
    token: str,
    user: User,
    farm_id: int | None,
    crop_id: int | None,
) -> str:
    """Validate ownership/context and return the persisted opaque group ID."""
    if not isinstance(token, str) or not token.strip() or len(token) > 512:
        raise _invalid_token()
    try:
        payload = json.loads(
            _fernet().decrypt(token.strip().encode('ascii'), ttl=_ttl_seconds())
        )
    except (
        InvalidToken,
        ValueError,
        UnicodeDecodeError,
        UnicodeEncodeError,
        TypeError,
        json.JSONDecodeError,
    ):
        raise _invalid_token()

    if not isinstance(payload, dict):
        raise _invalid_token()
    if payload.get('v') != TOKEN_VERSION:
        raise _invalid_token()
    if payload.get('uid') != int(user.id):
        raise _invalid_token()
    group_id = payload.get('group')
    if not isinstance(group_id, str) or not group_id or len(group_id) > 64:
        raise _invalid_token()
    expires_epoch = payload.get('exp')
    if (
        not isinstance(expires_epoch, int)
        or isinstance(expires_epoch, bool)
        or expires_epoch < int(datetime.now(timezone.utc).timestamp())
    ):
        raise _invalid_token()

    # A session is bound to the context selected when it started. This prevents
    # one group from silently spanning farms or crops.
    if payload.get('farm_id') != farm_id or payload.get('crop_id') != crop_id:
        raise HTTPException(
            422,
            'The collection context does not match the selected farm and crop. '
            'Start a new collection for this context.',
        )
    return group_id

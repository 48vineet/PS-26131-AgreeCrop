import os
import json
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from fastapi import Header, HTTPException, Depends
try:
    from jose import jwt, JWTError
except ImportError:
    jwt = None
    class JWTError(Exception): pass
from sqlalchemy.orm import Session
from database import get_db
from models_db import User

def _claims_from_token(token: str) -> dict:
    """Verify a bearer token and return its claims."""
    # For ES256 tokens, we must use Supabase's API validation
    # Local validation with HMAC secrets won't work for ES256

    url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
    key = os.getenv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')

    if not url or not key:
        raise HTTPException(503, 'Authentication is not configured')

    try:
        print(f"[TOKEN] Validating with Supabase API...")
        req = Request(
            f'{url}/auth/v1/user',
            headers={'apikey': key, 'Authorization': f'Bearer {token}'}
        )
        with urlopen(req, timeout=10) as res:
            result = json.loads(res.read().decode())
            print(f"[TOKEN] Validation SUCCESS: {result.get('id')}")
            return result

    except HTTPError as exc:
        print(f"[TOKEN] HTTPError {exc.code}: {exc.reason}")
        if exc.code in (401, 403):
            raise HTTPException(401, 'Invalid authentication token')
        raise HTTPException(503, 'Authentication service unavailable')
    except (URLError, TimeoutError) as e:
        print(f"[TOKEN] Connection error: {type(e).__name__}: {e}")
        raise HTTPException(503, 'Authentication service unavailable')

def _user_from_claims(claims: dict, db: Session) -> User:
    """Return the local user for these claims, creating it on first sight."""
    auth_id = claims.get('sub') or claims.get('id')
    user = db.query(User).filter(User.auth_user_id == auth_id).first()
    if not user:
        metadata = claims.get('user_metadata') or {}
        user = User(
            auth_user_id=auth_id,
            email=claims.get('email'),
            phone=metadata.get('phone'),
            name=metadata.get('name') or claims.get('email') or 'Farmer',
            role='farmer',
        )
        db.add(user); db.commit(); db.refresh(user)
    return user

def get_current_user(authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    if not authorization or not authorization.lower().startswith('bearer '):
        print(f"[AUTH] Authorization header missing or invalid: {authorization}")
        raise HTTPException(401, 'Authentication required')
    token = authorization.split(' ', 1)[1]
    print(f"[AUTH] Token received: {token[:20]}...")
    return _user_from_claims(_claims_from_token(token), db)

def get_optional_user(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> User | None:
    """Resolve the caller when they supplied a credential, otherwise ``None``.

    For endpoints that must serve anonymous callers but do more for a known one
    -- image screening returns a result to anyone, and retains it only for a
    signed-in submitter.

    A *present* Authorization header is an assertion of identity and is always
    verified: a malformed or invalid one raises 401 rather than being downgraded
    to anonymous. Silently treating a failed credential as no credential would
    let a caller believe their screening was recorded when it was not.

    No database work happens for an anonymous request, so the endpoint stays
    available when the database is unreachable.
    """
    if authorization is None or not authorization.strip():
        return None
    if not authorization.lower().startswith('bearer '):
        raise HTTPException(401, 'Invalid authentication token')
    return _user_from_claims(_claims_from_token(authorization.split(' ', 1)[1]), db)

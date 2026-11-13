from datetime import datetime, timedelta, timezone
import uuid
from jose import jwt, JWTError
from passlib.context import CryptContext
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select, delete, or_
from sqlalchemy.orm import Session
from .core import settings
from .database import get_db
from .models import User, AuthSession

# bcrypt_sha256 avoids bcrypt's 72-byte input truncation. Legacy bcrypt hashes
# remain verifiable and are upgraded automatically on the next password change.
pwd = CryptContext(schemes=["bcrypt_sha256", "bcrypt"], deprecated=["bcrypt"])
bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return pwd.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        return pwd.verify(password, hashed)
    except (ValueError, TypeError):
        return False


def create_token(user_id: str, db: Session) -> str:
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=settings.access_token_expire_minutes)
    token_id = str(uuid.uuid4())
    cleanup_before = now - timedelta(days=90)
    db.execute(delete(AuthSession).where(or_(
        AuthSession.expires_at < cleanup_before,
        AuthSession.revoked_at < cleanup_before,
    )))
    db.add(AuthSession(user_id=user_id, token_id=token_id, created_at=now, expires_at=expires))
    db.flush()
    return jwt.encode({"sub": user_id, "jti": token_id, "iat": now, "exp": expires},
                      settings.secret_key, algorithm="HS256")


def current_user(creds: HTTPAuthorizationCredentials = Depends(bearer),
                 db: Session = Depends(get_db)) -> User:
    if not creds:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        claims = jwt.decode(creds.credentials, settings.secret_key, algorithms=["HS256"])
        uid = claims.get("sub")
        token_id = claims.get("jti")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if not uid or not token_id:
        raise HTTPException(status_code=401, detail="Session is no longer valid. Please sign in again.")
    session = db.scalar(select(AuthSession).where(
        AuthSession.token_id == token_id, AuthSession.user_id == uid
    ))
    now = datetime.now(timezone.utc)
    if not session or session.revoked_at is not None:
        raise HTTPException(status_code=401, detail="Session has been revoked. Please sign in again.")
    expiry = session.expires_at
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    if expiry <= now:
        raise HTTPException(status_code=401, detail="Session has expired. Please sign in again.")
    user = db.get(User, uid)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if settings.require_email_verification and not user.email_verified:
        raise HTTPException(status_code=403, detail="Verify your email address before using the application.")
    return user

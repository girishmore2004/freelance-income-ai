"""One-time email action tokens; only SHA-256 digests are stored."""
from datetime import datetime, timedelta, timezone
import hashlib
import secrets
from sqlalchemy import select, update, delete, or_
from sqlalchemy.orm import Session
from ..models import EmailActionToken


def issue_action_token(db: Session, user_id: str, purpose: str, lifetime_minutes: int) -> str:
    raw = secrets.token_urlsafe(48)
    now = datetime.now(timezone.utc)
    cleanup_before = now - timedelta(days=30)
    db.execute(delete(EmailActionToken).where(or_(
        EmailActionToken.expires_at < cleanup_before,
        EmailActionToken.used_at < cleanup_before,
    )))
    # Invalidate earlier unused tokens for the same action to reduce replay surface.
    db.execute(update(EmailActionToken).where(
        EmailActionToken.user_id == user_id,
        EmailActionToken.purpose == purpose,
        EmailActionToken.used_at.is_(None),
    ).values(used_at=now))
    db.add(EmailActionToken(
        user_id=user_id,
        token_hash=hashlib.sha256(raw.encode("utf-8")).hexdigest(),
        purpose=purpose,
        created_at=now,
        expires_at=now + timedelta(minutes=lifetime_minutes),
    ))
    db.flush()
    return raw


def consume_action_token(db: Session, raw: str, purpose: str):
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    row = db.scalar(select(EmailActionToken).where(
        EmailActionToken.token_hash == digest,
        EmailActionToken.purpose == purpose,
    ).with_for_update())
    if not row or row.used_at is not None:
        return None
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires <= datetime.now(timezone.utc):
        return None
    row.used_at = datetime.now(timezone.utc)
    db.flush()
    return row

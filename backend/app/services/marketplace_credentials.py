"""Encrypted marketplace OAuth token storage primitives.

Provider OAuth callbacks must call save_tokens only after state/PKCE validation
and an official provider token exchange. This module intentionally performs no
network requests and never logs or returns token values.
"""
import json
from datetime import datetime, timezone
from fastapi import HTTPException
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.orm import Session
from ..core import settings
from ..models import MarketplaceCredential, MarketplaceAuditEvent

ALLOWED_PROVIDERS = {"upwork", "freelancer"}


def _cipher():
    key = getattr(settings, "oauth_encryption_key", "")
    if not key:
        raise HTTPException(503, "Set OAUTH_ENCRYPTION_KEY before storing marketplace credentials")
    try:
        return Fernet(key.encode())
    except Exception as exc:
        raise HTTPException(503, "OAUTH_ENCRYPTION_KEY must be a valid Fernet key") from exc


def encrypt_secret(value: str) -> str:
    if not value:
        return ""
    return _cipher().encrypt(value.encode()).decode()


def decrypt_secret(value: str) -> str:
    if not value:
        return ""
    try:
        return _cipher().decrypt(value.encode()).decode()
    except (InvalidToken, ValueError) as exc:
        raise HTTPException(503, "Stored marketplace credentials cannot be decrypted; reconnect the provider") from exc


def save_tokens(db: Session, user_id: str, provider: str, access_token: str,
                refresh_token: str = "", expires_at: datetime | None = None, scopes: list[str] | None = None):
    """Persist tokens after a trusted OAuth callback; never call from a public token-input endpoint."""
    if provider not in ALLOWED_PROVIDERS:
        raise HTTPException(400, "Unsupported marketplace provider")
    if not access_token:
        raise HTTPException(400, "Access token is required")
    encrypted_access = encrypt_secret(access_token)
    encrypted_refresh = encrypt_secret(refresh_token)
    row = db.scalar(select(MarketplaceCredential).where(
        MarketplaceCredential.user_id == user_id, MarketplaceCredential.provider == provider))
    if row is None:
        row = MarketplaceCredential(user_id=user_id, provider=provider,
                                    access_token_encrypted=encrypted_access)
        db.add(row)
    row.access_token_encrypted = encrypted_access
    row.refresh_token_encrypted = encrypted_refresh
    row.token_expires_at = expires_at
    row.scopes = json.dumps(sorted(set(scopes or [])))
    # Encrypted storage alone is not proof that the provider accepted the token.
    row.status = "stored_unverified"
    row.updated_at = datetime.now(timezone.utc)
    db.add(MarketplaceAuditEvent(
        user_id=user_id, provider=provider, event_type="credential_material_stored",
        detail="Encrypted marketplace credential material stored; provider identity and API access remain unverified.",
        actor="system",
    ))
    db.flush()
    return row


def load_tokens(row: MarketplaceCredential) -> dict[str, str]:
    return {"access_token": decrypt_secret(row.access_token_encrypted),
            "refresh_token": decrypt_secret(row.refresh_token_encrypted)}

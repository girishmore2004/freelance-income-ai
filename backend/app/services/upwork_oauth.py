"""Upwork OAuth 2.0 authorization-code + PKCE integration.

This module implements only the documented OAuth token exchange. It does not
call the Upwork GraphQL API or claim that marketplace data access is enabled.
"""
import hashlib
import base64
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core import settings
from ..models import EmailOAuthState, MarketplaceCredential, MarketplaceConnection, MarketplaceAuditEvent
from .marketplace_credentials import encrypt_secret, decrypt_secret, save_tokens, load_tokens

AUTHORIZE_URL = "https://www.upwork.com/ab/account-security/oauth2/authorize"
TOKEN_URL = "https://www.upwork.com/api/v3/oauth2/token"
PROVIDER = "upwork"


def _config():
    client_id = getattr(settings, "upwork_client_id", "")
    client_secret = getattr(settings, "upwork_client_secret", "")
    redirect_uri = getattr(settings, "upwork_redirect_uri", "")
    scopes = getattr(settings, "upwork_scopes", "")
    if not all((client_id, client_secret, redirect_uri, scopes)):
        raise HTTPException(503, "Configure UPWORK_CLIENT_ID, UPWORK_CLIENT_SECRET, UPWORK_REDIRECT_URI and approved UPWORK_SCOPES")
    if not redirect_uri.startswith("https://") and getattr(settings, "environment", "development") == "production":
        raise HTTPException(503, "UPWORK_REDIRECT_URI must use HTTPS in production")
    # Validate encryption configuration before issuing an authorization URL.
    encrypt_secret("oauth-config-check")
    return {"client_id": client_id, "client_secret": client_secret,
            "redirect_uri": redirect_uri, "scopes": scopes.split()}


def start_upwork_oauth(db: Session, user_id: str) -> str:
    cfg = _config()
    now = datetime.now(timezone.utc)
    db.query(EmailOAuthState).filter(
        EmailOAuthState.user_id == user_id,
        EmailOAuthState.provider == PROVIDER,
        EmailOAuthState.expires_at < now,
    ).delete(synchronize_session=False)
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    db.add(EmailOAuthState(
        user_id=user_id, provider=PROVIDER,
        state_hash=hashlib.sha256(state.encode()).hexdigest(),
        code_verifier=encrypt_secret(verifier), expires_at=now + timedelta(minutes=10),
    ))
    db.commit()
    params = {
        "client_id": cfg["client_id"], "redirect_uri": cfg["redirect_uri"],
        "response_type": "code", "scope": " ".join(cfg["scopes"]),
        "state": state, "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    return AUTHORIZE_URL + "?" + urlencode(params)


async def complete_upwork_oauth(db: Session, code: str, state: str) -> str:
    cfg = _config()
    if not code or not state or len(code) > 4096 or len(state) > 512:
        raise HTTPException(400, "OAuth callback is missing valid code or state")
    digest = hashlib.sha256(state.encode()).hexdigest()
    row = db.scalar(select(EmailOAuthState).where(
        EmailOAuthState.provider == PROVIDER,
        EmailOAuthState.state_hash == digest,
    ).with_for_update())
    now = datetime.now(timezone.utc)
    expiry = row.expires_at.replace(tzinfo=timezone.utc) if row and row.expires_at.tzinfo is None else (row.expires_at if row else now)
    if not row or row.used_at or expiry <= now:
        raise HTTPException(400, "OAuth state is invalid, expired or already used")
    row.used_at = now
    verifier = decrypt_secret(row.code_verifier)
    user_id = row.user_id
    db.commit()  # consume state before outbound request to prevent replay
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
            response = await client.post(TOKEN_URL, data={
                "client_id": cfg["client_id"], "client_secret": cfg["client_secret"],
                "code": code, "code_verifier": verifier,
                "redirect_uri": cfg["redirect_uri"], "grant_type": "authorization_code",
            }, headers={"Accept": "application/json"})
    except httpx.RequestError as exc:
        raise HTTPException(502, "Upwork OAuth token exchange could not reach the provider") from exc
    if response.status_code >= 400:
        raise HTTPException(502, "Upwork OAuth token exchange failed; verify API approval, scopes and callback configuration")
    try:
        data = response.json()
    except ValueError as exc:
        raise HTTPException(502, "Upwork returned an invalid OAuth response") from exc
    access = data.get("access_token")
    if not isinstance(access, str) or not access:
        raise HTTPException(502, "Upwork did not return an access token")
    granted_scopes = data.get("scope") or " ".join(cfg["scopes"])
    if isinstance(granted_scopes, str):
        scopes = granted_scopes.split()
    elif isinstance(granted_scopes, list):
        scopes = [str(x) for x in granted_scopes]
    else:
        scopes = []
    expires_at = now + timedelta(seconds=max(60, int(data.get("expires_in", 86400))))
    save_tokens(db, user_id, PROVIDER, access, data.get("refresh_token", ""), expires_at, scopes)
    connection = db.scalar(select(MarketplaceConnection).where(
        MarketplaceConnection.user_id == user_id, MarketplaceConnection.provider == PROVIDER))
    if connection is None:
        connection = MarketplaceConnection(user_id=user_id, provider=PROVIDER)
        db.add(connection)
    connection.status = "oauth_token_received"
    connection.access_mode = "official_api_pending"
    connection.last_checked_at = now
    connection.last_error = "OAuth token received; account identity and GraphQL API access have not yet been verified."
    db.add(MarketplaceAuditEvent(
        user_id=user_id, provider=PROVIDER, event_type="oauth_token_received",
        detail="Upwork OAuth token exchange succeeded. API scopes and account-level data access remain unverified.", actor="system",
    ))
    db.commit()
    return user_id


async def refresh_upwork_token(db: Session, user_id: str) -> dict:
    cfg = _config()
    credential = db.scalar(select(MarketplaceCredential).where(
        MarketplaceCredential.user_id == user_id, MarketplaceCredential.provider == PROVIDER))
    if not credential:
        raise HTTPException(404, "No stored Upwork credential exists")
    tokens = load_tokens(credential)
    if not tokens["refresh_token"]:
        raise HTTPException(409, "Upwork refresh token is unavailable; reconnect the provider")
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
            response = await client.post(TOKEN_URL, data={
                "client_id": cfg["client_id"], "client_secret": cfg["client_secret"],
                "refresh_token": tokens["refresh_token"], "grant_type": "refresh_token",
            }, headers={"Accept": "application/json"})
    except httpx.RequestError as exc:
        raise HTTPException(502, "Upwork token refresh could not reach the provider") from exc
    if response.status_code >= 400:
        credential.status = "reauthorization_required"
        connection = db.scalar(select(MarketplaceConnection).where(
            MarketplaceConnection.user_id == user_id, MarketplaceConnection.provider == PROVIDER))
        if connection:
            connection.status = "reauthorization_required"
            connection.access_mode = "official_api_pending"
            connection.last_error = "Upwork token refresh failed; reconnect authorization."
        db.commit()
        raise HTTPException(409, "Upwork token refresh failed; reconnect the provider")
    try:
        data = response.json()
    except ValueError as exc:
        raise HTTPException(502, "Upwork returned an invalid token refresh response") from exc
    if not data.get("access_token"):
        raise HTTPException(502, "Upwork did not return a refreshed access token")
    credential.access_token_encrypted = encrypt_secret(data["access_token"])
    if data.get("refresh_token"):
        credential.refresh_token_encrypted = encrypt_secret(data["refresh_token"])
    credential.token_expires_at = datetime.now(timezone.utc) + timedelta(seconds=max(60, int(data.get("expires_in", 86400))))
    credential.status = "stored_unverified"
    credential.updated_at = datetime.now(timezone.utc)
    connection = db.scalar(select(MarketplaceConnection).where(
        MarketplaceConnection.user_id == user_id, MarketplaceConnection.provider == PROVIDER))
    if connection:
        connection.status = "token_refreshed_unverified"
        connection.access_mode = "official_api_pending"
        connection.last_error = "Token refreshed; run a read-only marketplace search to re-verify API access."
    db.add(MarketplaceAuditEvent(
        user_id=user_id, provider=PROVIDER, event_type="oauth_token_refreshed",
        detail="Upwork access token refreshed. Marketplace API access remains unverified.", actor="system",
    ))
    db.commit()
    return {"provider": PROVIDER, "credential_status": credential.status,
            "token_expires_at": credential.token_expires_at.isoformat(),
            "live_api_verified": False}

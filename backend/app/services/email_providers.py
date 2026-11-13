import base64
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import parseaddr, parsedate_to_datetime
from html.parser import HTMLParser
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core import settings
from ..models import ClientEmail, EmailOAuthState, EmailProviderAccount, User

GOOGLE_SCOPES = [
    "openid", "email",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
]
MICROSOFT_SCOPES = [
    "openid", "profile", "email", "offline_access",
    "User.Read", "Mail.Read", "Mail.Send",
]


def _provider_config(provider: str):
    if provider == "google":
        return {
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "redirect_uri": settings.google_redirect_uri,
            "authorize": "https://accounts.google.com/o/oauth2/v2/auth",
            "token": "https://oauth2.googleapis.com/token",
            "scopes": GOOGLE_SCOPES,
        }
    if provider == "microsoft":
        base = f"https://login.microsoftonline.com/{settings.microsoft_tenant_id or 'common'}/oauth2/v2.0"
        return {
            "client_id": settings.microsoft_client_id,
            "client_secret": settings.microsoft_client_secret,
            "redirect_uri": settings.microsoft_redirect_uri,
            "authorize": base + "/authorize",
            "token": base + "/token",
            "scopes": MICROSOFT_SCOPES,
        }
    raise HTTPException(400, "Provider must be google or microsoft")


def _fernet():
    if not settings.oauth_encryption_key:
        raise HTTPException(503, "Set OAUTH_ENCRYPTION_KEY before connecting an email provider")
    try:
        return Fernet(settings.oauth_encryption_key.encode())
    except Exception as exc:
        raise HTTPException(503, "OAUTH_ENCRYPTION_KEY must be a valid Fernet key") from exc


def encrypt_token(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt_token(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode()).decode()
    except (InvalidToken, ValueError) as exc:
        raise HTTPException(503, "Stored provider credentials cannot be decrypted; reconnect the mailbox") from exc


def start_oauth(db: Session, user: User, provider: str) -> str:
    cfg = _provider_config(provider)
    if not cfg["client_id"] or not cfg["client_secret"] or not cfg["redirect_uri"]:
        raise HTTPException(503, f"{provider.title()} OAuth client ID, secret and redirect URI must be configured")
    _fernet()
    now = datetime.now(timezone.utc)
    db.query(EmailOAuthState).filter(
        EmailOAuthState.user_id == user.id,
        EmailOAuthState.provider == provider,
        EmailOAuthState.expires_at < now,
    ).delete()
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    db.add(EmailOAuthState(
        user_id=user.id,
        provider=provider,
        state_hash=hashlib.sha256(state.encode()).hexdigest(),
        code_verifier=encrypt_token(verifier),
        expires_at=now + timedelta(minutes=10),
    ))
    db.commit()
    params = {
        "client_id": cfg["client_id"],
        "redirect_uri": cfg["redirect_uri"],
        "response_type": "code",
        "scope": " ".join(cfg["scopes"]),
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    if provider == "google":
        params.update({"access_type": "offline", "prompt": "consent", "include_granted_scopes": "true"})
    else:
        params["response_mode"] = "query"
    return cfg["authorize"] + "?" + urlencode(params)


async def complete_oauth(db: Session, provider: str, code: str, state: str):
    cfg = _provider_config(provider)
    state_hash = hashlib.sha256(state.encode()).hexdigest()
    # Lock the state row on databases that support SELECT FOR UPDATE. This
    # serializes concurrent callbacks so only one request can consume a state.
    row = db.scalar(select(EmailOAuthState).where(
        EmailOAuthState.provider == provider,
        EmailOAuthState.state_hash == state_hash,
    ).with_for_update())
    now = datetime.now(timezone.utc)
    expiry = row.expires_at.replace(tzinfo=timezone.utc) if row and row.expires_at.tzinfo is None else (row.expires_at if row else now)
    if not row or row.used_at or expiry <= now:
        raise HTTPException(400, "OAuth state is invalid, expired or already used")
    row.used_at = now
    verifier = decrypt_token(row.code_verifier)
    user_id = row.user_id
    db.commit()  # Consume state before any external request, preventing callback replay.

    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
            response = await client.post(cfg["token"], data={
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
                "code": code,
                "code_verifier": verifier,
                "redirect_uri": cfg["redirect_uri"],
                "grant_type": "authorization_code",
            }, headers={"Accept": "application/json"})
    except httpx.RequestError as exc:
        raise HTTPException(502, "Email provider token exchange could not reach the provider") from exc
    if response.status_code >= 400:
        raise HTTPException(502, "Email provider OAuth token exchange failed; verify redirect URI and consent configuration")
    token_data = response.json()
    access = token_data.get("access_token")
    if not access:
        raise HTTPException(502, "Provider did not return an access token")
    granted = set((token_data.get("scope") or "").split())
    required = ({"https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"}
                if provider == "google" else {"Mail.Read", "Mail.Send"})
    if granted and not required.issubset(granted):
        raise HTTPException(403, "Provider consent did not include both required mail read and send permissions")
    email_address = ""
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            if provider == "google":
                who = await client.get("https://www.googleapis.com/oauth2/v2/userinfo",
                                       headers={"Authorization": f"Bearer {access}"})
                if who.is_success:
                    email_address = who.json().get("email", "")
            else:
                who = await client.get(
                    "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName",
                    headers={"Authorization": f"Bearer {access}"})
                if who.is_success:
                    info = who.json()
                    email_address = info.get("mail") or info.get("userPrincipalName") or ""
    except httpx.RequestError as exc:
        raise HTTPException(502, "Provider account identity could not be verified; reconnect and retry") from exc
    if not email_address:
        raise HTTPException(502, "Provider account identity could not be verified")
    account = db.scalar(select(EmailProviderAccount).where(
        EmailProviderAccount.user_id == user_id,
        EmailProviderAccount.provider == provider,
    ))
    if not account:
        account = EmailProviderAccount(
            user_id=user_id, provider=provider,
            access_token_encrypted="", refresh_token_encrypted="",
        )
        db.add(account)
    account.provider_email = email_address[:320]
    account.access_token_encrypted = encrypt_token(access)
    if token_data.get("refresh_token"):
        account.refresh_token_encrypted = encrypt_token(token_data["refresh_token"])
    account.token_expires_at = now + timedelta(seconds=max(60, int(token_data.get("expires_in", 3600))))
    account.scopes = token_data.get("scope", " ".join(cfg["scopes"]))
    account.status = "connected"
    account.last_sync_error = ""
    account.updated_at = now
    db.commit()
    return user_id, email_address


async def _access_token(db: Session, account: EmailProviderAccount) -> str:
    now = datetime.now(timezone.utc)
    expiry = account.token_expires_at
    if expiry and expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    if expiry and expiry > now + timedelta(seconds=90):
        return decrypt_token(account.access_token_encrypted)
    if not account.refresh_token_encrypted:
        account.status = "reauthorization_required"
        db.commit()
        raise HTTPException(409, "Provider refresh token is unavailable; reconnect the mailbox")
    cfg = _provider_config(account.provider)
    refresh = decrypt_token(account.refresh_token_encrypted)
    refresh_data = {
        "client_id": cfg["client_id"],
        "client_secret": cfg["client_secret"],
        "refresh_token": refresh,
        "grant_type": "refresh_token",
    }
    if account.provider == "microsoft":
        refresh_data["scope"] = " ".join(cfg["scopes"])
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
            response = await client.post(cfg["token"], data=refresh_data)
    except httpx.RequestError as exc:
        raise HTTPException(502, "Provider token refresh could not reach the provider; no email was sent") from exc
    if response.status_code >= 400:
        account.status = "reauthorization_required"
        db.commit()
        raise HTTPException(409, "Provider token refresh failed; reconnect the mailbox")
    data = response.json()
    account.access_token_encrypted = encrypt_token(data["access_token"])
    if data.get("refresh_token"):
        account.refresh_token_encrypted = encrypt_token(data["refresh_token"])
    account.token_expires_at = now + timedelta(seconds=max(60, int(data.get("expires_in", 3600))))
    account.updated_at = now
    db.commit()
    return data["access_token"]


async def ensure_access_token(db: Session, account: EmailProviderAccount) -> str:
    return await _access_token(db, account)


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        value = data.strip()
        if value:
            self.parts.append(value)


def _decode_b64(value: str) -> str:
    if not value:
        return ""
    raw = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    return raw.decode("utf-8", errors="replace")


def _gmail_body(payload: dict) -> str:
    plain, html = [], []

    def walk(part):
        mime = part.get("mimeType", "")
        data = (part.get("body") or {}).get("data", "")
        if data:
            decoded = _decode_b64(data)
            if mime == "text/plain":
                plain.append(decoded)
            elif mime == "text/html":
                html.append(decoded)
        for child in part.get("parts", []) or []:
            walk(child)

    walk(payload or {})
    if plain:
        return "\n".join(plain)[:30000]
    if html:
        parser = _TextExtractor()
        parser.feed("\n".join(html))
        return "\n".join(parser.parts)[:30000]
    return ""


def _parse_date(value: str):
    try:
        dt = parsedate_to_datetime(value)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


async def sync_mailbox(db: Session, account: EmailProviderAccount):
    token = await _access_token(db, account)
    async with httpx.AsyncClient(timeout=25) as client:
        if account.provider == "google":
            headers = {"Authorization": f"Bearer {token}"}
            listing = await client.get(
                "https://gmail.googleapis.com/gmail/v1/users/me/messages",
                headers=headers,
                params={"maxResults": 50, "q": "in:inbox newer_than:30d"},
            )
            if listing.status_code >= 400:
                raise HTTPException(502, "Gmail inbox listing failed; verify granted Gmail scopes")
            for item in listing.json().get("messages", []):
                exists = db.scalar(select(ClientEmail.id).where(
                    ClientEmail.user_id == account.user_id,
                    ClientEmail.provider == "google",
                    ClientEmail.external_id == item.get("id", ""),
                ))
                if exists:
                    continue
                detail = await client.get(
                    f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{item['id']}",
                    headers=headers, params={"format": "full"},
                )
                if detail.status_code >= 400:
                    continue
                message = detail.json()
                headers_map = {
                    h.get("name", "").lower(): h.get("value", "")
                    for h in message.get("payload", {}).get("headers", [])
                }
                sender_name, sender_email = parseaddr(headers_map.get("from", ""))
                body = _gmail_body(message.get("payload", {})) or message.get("snippet", "")
                yield {
                    "provider": "google",
                    "external_id": item["id"],
                    "thread_id": message.get("threadId", ""),
                    "rfc_message_id": headers_map.get("message-id", "")[:998],
                    "sender_name": sender_name,
                    "sender_email": sender_email,
                    "subject": headers_map.get("subject", "")[:500],
                    "body_text": body or "(No readable message body)",
                    "received_at": _parse_date(headers_map.get("date", "")),
                }
        elif account.provider == "microsoft":
            headers = {"Authorization": f"Bearer {token}"}
            listing = await client.get(
                "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages",
                headers=headers,
                params={
                    "$top": "50",
                    "$select": "id,conversationId,subject,from,receivedDateTime,body",
                    "$orderby": "receivedDateTime desc",
                },
            )
            if listing.status_code >= 400:
                raise HTTPException(502, "Outlook inbox listing failed; verify Microsoft Graph Mail.Read consent")
            for message in listing.json().get("value", []):
                from_addr = (message.get("from") or {}).get("emailAddress") or {}
                body_data = message.get("body") or {}
                body_content = body_data.get("content") or ""
                if body_data.get("contentType") == "html":
                    parser = _TextExtractor()
                    parser.feed(body_content)
                    body_content = "\n".join(parser.parts)
                received = message.get("receivedDateTime")
                yield {
                    "provider": "microsoft",
                    "external_id": message.get("id", ""),
                    "thread_id": message.get("conversationId", ""),
                    "rfc_message_id": "",
                    "sender_name": from_addr.get("name", ""),
                    "sender_email": from_addr.get("address", ""),
                    "subject": (message.get("subject") or "")[:500],
                    "body_text": body_content[:30000] or "(No readable message body)",
                    "received_at": datetime.fromisoformat(received.replace("Z", "+00:00"))
                        if received else datetime.now(timezone.utc),
                }
        else:
            raise HTTPException(400, "Unsupported email provider")


async def send_approved_reply(
    db: Session,
    account: EmailProviderAccount,
    recipient: str,
    subject: str,
    body_text: str,
    thread_id: str = "",
    original_message_id: str = "",
    rfc_message_id: str = "",
):
    token = await _access_token(db, account)
    if not recipient or "@" not in recipient or len(recipient) > 320:
        raise HTTPException(409, "Original sender address is missing; reply cannot be sent safely")
    async with httpx.AsyncClient(timeout=25) as client:
        if account.provider == "google":
            message = EmailMessage()
            message["To"] = recipient
            message["Subject"] = subject
            if rfc_message_id:
                message["In-Reply-To"] = rfc_message_id
                message["References"] = rfc_message_id
            message.set_content(body_text)
            raw = base64.urlsafe_b64encode(message.as_bytes()).decode().rstrip("=")
            payload = {"raw": raw}
            if thread_id:
                payload["threadId"] = thread_id
            response = await client.post(
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
                headers={"Authorization": f"Bearer {token}"},
                json=payload,
            )
            if response.status_code >= 400:
                raise HTTPException(502, "Gmail rejected the approved reply; check mailbox permissions")
            result = response.json() if response.content else {}
            return result.get("id", "accepted")

        if account.provider == "microsoft":
            if not original_message_id:
                raise HTTPException(409, "Original Outlook message ID is missing; cannot create a reply thread")
            base = "https://graph.microsoft.com/v1.0/me/messages"
            reply = await client.post(
                f"{base}/{original_message_id}/createReply",
                headers={"Authorization": f"Bearer {token}"},
            )
            if reply.status_code >= 400:
                raise HTTPException(502, "Outlook could not create a reply draft for the original message")
            reply_id = reply.json().get("id")
            if not reply_id:
                raise HTTPException(502, "Outlook did not return a reply draft identifier")
            updated = await client.patch(
                f"{base}/{reply_id}",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={"body": {"contentType": "Text", "content": body_text}},
            )
            if updated.status_code >= 400:
                raise HTTPException(502, "Outlook reply draft could not be updated; nothing was sent")
            sent = await client.post(
                f"{base}/{reply_id}/send",
                headers={"Authorization": f"Bearer {token}"},
            )
            if sent.status_code >= 400:
                raise HTTPException(502, "Outlook rejected the approved reply send request")
            return reply_id
    raise HTTPException(400, "Unsupported email provider")

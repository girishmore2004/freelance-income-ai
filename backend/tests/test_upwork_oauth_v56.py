from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException
from cryptography.fernet import Fernet

from app.services import upwork_oauth as oauth
from app.services import marketplace_credentials as vault
from app.models import EmailOAuthState


class FakeQuery:
    def filter(self, *args, **kwargs):
        return self
    def delete(self, **kwargs):
        return 0


class FakeDB:
    def __init__(self, scalar_rows=None):
        self.rows = list(scalar_rows or [])
        self.added = []
        self.commits = 0
    def query(self, model):
        return FakeQuery()
    def add(self, row):
        self.added.append(row)
    def scalar(self, statement):
        return self.rows.pop(0) if self.rows else None
    def commit(self):
        self.commits += 1
    def flush(self):
        pass


def configure(monkeypatch):
    monkeypatch.setattr(oauth.settings, "upwork_client_id", "client-id")
    monkeypatch.setattr(oauth.settings, "upwork_client_secret", "client-secret")
    monkeypatch.setattr(oauth.settings, "upwork_redirect_uri", "https://api.example.com/api/v1/marketplaces/upwork/oauth/callback")
    monkeypatch.setattr(oauth.settings, "upwork_scopes", "common_entities_read")
    monkeypatch.setattr(oauth.settings, "environment", "production")
    monkeypatch.setattr(vault.settings, "oauth_encryption_key", Fernet.generate_key().decode())


def test_upwork_oauth_config_fails_closed_when_scopes_missing(monkeypatch):
    configure(monkeypatch)
    monkeypatch.setattr(oauth.settings, "upwork_scopes", "")
    with pytest.raises(HTTPException) as exc:
        oauth._config()
    assert exc.value.status_code == 503


def test_start_oauth_uses_state_and_pkce(monkeypatch):
    configure(monkeypatch)
    db = FakeDB()
    url = oauth.start_upwork_oauth(db, "user-1")
    query = parse_qs(urlparse(url).query)
    assert url.startswith(oauth.AUTHORIZE_URL)
    assert query["response_type"] == ["code"]
    assert query["code_challenge_method"] == ["S256"]
    assert len(query["state"][0]) >= 32
    state_row = next(x for x in db.added if isinstance(x, EmailOAuthState))
    assert state_row.user_id == "user-1"
    assert state_row.provider == "upwork"
    assert state_row.state_hash != query["state"][0]
    assert state_row.expires_at > datetime.now(timezone.utc)


@pytest.mark.asyncio
async def test_callback_rejects_invalid_state_before_network(monkeypatch):
    configure(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        await oauth.complete_upwork_oauth(FakeDB(), "code", "invalid-state")
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_callback_consumes_state_and_stores_tokens(monkeypatch):
    configure(monkeypatch)
    state = "one-time-state"
    verifier = "pkce-verifier"
    from app.services.marketplace_credentials import encrypt_secret
    row = EmailOAuthState(user_id="user-1", provider="upwork",
        state_hash=oauth.hashlib.sha256(state.encode()).hexdigest(),
        code_verifier=encrypt_secret(verifier),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5), used_at=None)
    db = FakeDB([row, None, None])

    class Response:
        status_code = 200
        def json(self):
            return {"access_token": "access-secret", "refresh_token": "refresh-secret",
                    "expires_in": 3600, "scope": "common_entities_read"}

    class Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): return False
        async def post(self, *args, **kwargs): return Response()

    monkeypatch.setattr(oauth.httpx, "AsyncClient", lambda **kwargs: Client())
    user_id = await oauth.complete_upwork_oauth(db, "auth-code", state)
    assert user_id == "user-1"
    assert row.used_at is not None
    credential = next(x for x in db.added if getattr(x, "__tablename__", "") == "marketplace_credentials")
    assert credential.access_token_encrypted != "access-secret"
    assert credential.refresh_token_encrypted != "refresh-secret"
    assert credential.status == "stored_unverified"
    assert any(getattr(x, "event_type", "") == "oauth_token_received" for x in db.added)


@pytest.mark.asyncio
async def test_refresh_requires_existing_credential(monkeypatch):
    configure(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        await oauth.refresh_upwork_token(FakeDB(), "user-1")
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_refresh_rotates_encrypted_tokens(monkeypatch):
    configure(monkeypatch)
    from app.services.marketplace_credentials import encrypt_secret, decrypt_secret
    credential = __import__('app.models', fromlist=['MarketplaceCredential']).MarketplaceCredential(
        user_id="user-1", provider="upwork",
        access_token_encrypted=encrypt_secret("old-access"),
        refresh_token_encrypted=encrypt_secret("old-refresh"),
        status="stored_unverified")
    db = FakeDB([credential])

    class Response:
        status_code = 200
        def json(self):
            return {"access_token": "new-access", "refresh_token": "new-refresh", "expires_in": 7200}

    class Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): return False
        async def post(self, *args, **kwargs):
            assert kwargs["data"]["grant_type"] == "refresh_token"
            assert kwargs["data"]["refresh_token"] == "old-refresh"
            return Response()

    monkeypatch.setattr(oauth.httpx, "AsyncClient", lambda **kwargs: Client())
    result = await oauth.refresh_upwork_token(db, "user-1")
    assert result["live_api_verified"] is False
    assert decrypt_secret(credential.access_token_encrypted) == "new-access"
    assert decrypt_secret(credential.refresh_token_encrypted) == "new-refresh"


@pytest.mark.asyncio
async def test_refresh_failure_requires_reauthorization(monkeypatch):
    configure(monkeypatch)
    from app.services.marketplace_credentials import encrypt_secret
    credential = __import__('app.models', fromlist=['MarketplaceCredential']).MarketplaceCredential(
        user_id="user-1", provider="upwork",
        access_token_encrypted=encrypt_secret("old-access"),
        refresh_token_encrypted=encrypt_secret("old-refresh"), status="stored_unverified")
    db = FakeDB([credential])

    class Response:
        status_code = 401
        def json(self): return {"error": "invalid_grant"}
    class Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): return False
        async def post(self, *args, **kwargs): return Response()
    monkeypatch.setattr(oauth.httpx, "AsyncClient", lambda **kwargs: Client())
    with pytest.raises(HTTPException) as exc:
        await oauth.refresh_upwork_token(db, "user-1")
    assert exc.value.status_code == 409
    assert credential.status == "reauthorization_required"

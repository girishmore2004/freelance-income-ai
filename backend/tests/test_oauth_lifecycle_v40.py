import asyncio
import hashlib
from datetime import datetime, timedelta, timezone

import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.core import settings
from app.database import Base
from app.models import EmailOAuthState, EmailProviderAccount, User
from app.services import email_providers


@pytest.fixture
def oauth_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        yield db
    finally:
        db.close()
        engine.dispose()


def _configure_google(monkeypatch):
    monkeypatch.setattr(settings, "oauth_encryption_key", Fernet.generate_key().decode())
    monkeypatch.setattr(settings, "google_client_id", "test-client")
    monkeypatch.setattr(settings, "google_client_secret", "test-secret")
    monkeypatch.setattr(settings, "google_redirect_uri", "https://app.test/oauth/google/callback")


def _add_state(db, user, state, expires_at, used_at=None):
    row = EmailOAuthState(
        user_id=user.id,
        provider="google",
        state_hash=hashlib.sha256(state.encode()).hexdigest(),
        code_verifier=email_providers.encrypt_token("pkce-verifier"),
        expires_at=expires_at,
        used_at=used_at,
    )
    db.add(row)
    db.commit()
    return row


def test_oauth_rejects_expired_state_without_provider_call(oauth_db, monkeypatch):
    _configure_google(monkeypatch)
    user = User(email="expired@example.test", password_hash="test")
    oauth_db.add(user)
    oauth_db.commit()
    _add_state(oauth_db, user, "expired-state", datetime.now(timezone.utc) - timedelta(seconds=1))

    async def unexpected_client(*args, **kwargs):
        raise AssertionError("expired state must be rejected before network access")

    monkeypatch.setattr(email_providers.httpx, "AsyncClient", unexpected_client)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(email_providers.complete_oauth(oauth_db, "google", "code", "expired-state"))
    assert exc.value.status_code == 400
    assert oauth_db.scalar(select(EmailProviderAccount)) is None


def test_oauth_state_is_consumed_before_token_exchange_and_cannot_replay(oauth_db, monkeypatch):
    _configure_google(monkeypatch)
    user = User(email="replay@example.test", password_hash="test")
    oauth_db.add(user)
    oauth_db.commit()
    row = _add_state(oauth_db, user, "replay-state", datetime.now(timezone.utc) + timedelta(minutes=5))

    class FailingClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, *args, **kwargs):
            raise email_providers.httpx.ConnectError("simulated provider outage")

    monkeypatch.setattr(email_providers.httpx, "AsyncClient", lambda **kwargs: FailingClient())
    with pytest.raises(HTTPException) as first:
        asyncio.run(email_providers.complete_oauth(oauth_db, "google", "code", "replay-state"))
    assert first.value.status_code == 502
    oauth_db.refresh(row)
    assert row.used_at is not None

    with pytest.raises(HTTPException) as replay:
        asyncio.run(email_providers.complete_oauth(oauth_db, "google", "code", "replay-state"))
    assert replay.value.status_code == 400


def test_oauth_callback_persists_account_for_state_owner_only(oauth_db, monkeypatch):
    _configure_google(monkeypatch)
    owner = User(email="owner@example.test", password_hash="test")
    other = User(email="other@example.test", password_hash="test")
    oauth_db.add_all([owner, other])
    oauth_db.commit()
    _add_state(oauth_db, owner, "owner-bound-state", datetime.now(timezone.utc) + timedelta(minutes=5))

    class FakeResponse:
        status_code = 200
        is_success = True

        def __init__(self, data):
            self._data = data

        def json(self):
            return self._data

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, *args, **kwargs):
            return FakeResponse({
                "access_token": "access-secret",
                "refresh_token": "refresh-secret",
                "expires_in": 3600,
                "scope": "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
            })

        async def get(self, *args, **kwargs):
            return FakeResponse({"email": "verified-owner@example.test"})

    monkeypatch.setattr(email_providers.httpx, "AsyncClient", lambda **kwargs: FakeClient())
    result = asyncio.run(email_providers.complete_oauth(
        oauth_db, "google", "authorization-code", "owner-bound-state"
    ))
    assert result == (owner.id, "verified-owner@example.test")

    accounts = oauth_db.scalars(select(EmailProviderAccount)).all()
    assert len(accounts) == 1
    assert accounts[0].user_id == owner.id
    assert accounts[0].user_id != other.id
    assert accounts[0].access_token_encrypted != "access-secret"
    assert accounts[0].refresh_token_encrypted != "refresh-secret"


def test_oauth_identity_lookup_network_failure_is_reported_as_gateway_error(oauth_db, monkeypatch):
    _configure_google(monkeypatch)
    user = User(email="identity-failure@example.test", password_hash="test")
    oauth_db.add(user)
    oauth_db.commit()
    _add_state(oauth_db, user, "identity-failure-state", datetime.now(timezone.utc) + timedelta(minutes=5))

    class FakeResponse:
        status_code = 200
        is_success = True

        def json(self):
            return {
                "access_token": "access-secret",
                "scope": "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
            }

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, *args, **kwargs):
            return FakeResponse()

        async def get(self, *args, **kwargs):
            raise email_providers.httpx.ConnectError("simulated identity endpoint outage")

    monkeypatch.setattr(email_providers.httpx, "AsyncClient", lambda **kwargs: FakeClient())
    with pytest.raises(HTTPException) as exc:
        asyncio.run(email_providers.complete_oauth(
            oauth_db, "google", "authorization-code", "identity-failure-state"
        ))
    assert exc.value.status_code == 502
    assert oauth_db.scalar(select(EmailProviderAccount)) is None

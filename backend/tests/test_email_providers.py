import base64
from datetime import timezone
from cryptography.fernet import Fernet
from app.core import settings
from app.services.email_providers import (
    _decode_b64, _gmail_body, _parse_date, _provider_config,
    encrypt_token, decrypt_token,
)

def test_token_encryption_round_trip(monkeypatch):
    monkeypatch.setattr(settings, "oauth_encryption_key", Fernet.generate_key().decode())
    encrypted = encrypt_token("refresh-token-value")
    assert encrypted != "refresh-token-value"
    assert decrypt_token(encrypted) == "refresh-token-value"

def test_decode_base64url_with_missing_padding():
    value = base64.urlsafe_b64encode(b"Hello client").decode().rstrip("=")
    assert _decode_b64(value) == "Hello client"

def test_gmail_body_prefers_plain_text():
    payload = {
        "mimeType": "multipart/alternative",
        "parts": [
            {"mimeType": "text/plain", "body": {"data": base64.urlsafe_b64encode(b"Plain reply").decode().rstrip("=")}},
            {"mimeType": "text/html", "body": {"data": base64.urlsafe_b64encode(b"<p>HTML reply</p>").decode().rstrip("=")}},
        ],
    }
    assert _gmail_body(payload) == "Plain reply"

def test_parse_date_returns_timezone_aware_value():
    parsed = _parse_date("Tue, 10 Nov 2026 12:30:00 +0000")
    assert parsed.tzinfo is not None
    assert parsed.utcoffset().total_seconds() == 0

def test_provider_configuration_uses_expected_scopes(monkeypatch):
    monkeypatch.setattr(settings, "google_client_id", "client")
    monkeypatch.setattr(settings, "google_client_secret", "secret")
    monkeypatch.setattr(settings, "google_redirect_uri", "https://example.test/callback")
    config = _provider_config("google")
    assert "https://www.googleapis.com/auth/gmail.readonly" in config["scopes"]
    assert "https://www.googleapis.com/auth/gmail.send" in config["scopes"]

def test_unknown_provider_rejected():
    from fastapi import HTTPException
    try:
        _provider_config("other")
        assert False, "expected provider validation error"
    except HTTPException as exc:
        assert exc.status_code == 400


def test_oauth_start_uses_one_time_state_and_pkce(monkeypatch):
    from urllib.parse import urlparse, parse_qs
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import sessionmaker
    from app.database import Base
    from app.models import User, EmailOAuthState
    from app.services.email_providers import start_oauth, decrypt_token

    monkeypatch.setattr(settings, "oauth_encryption_key", Fernet.generate_key().decode())
    monkeypatch.setattr(settings, "google_client_id", "test-client")
    monkeypatch.setattr(settings, "google_client_secret", "test-secret")
    monkeypatch.setattr(settings, "google_redirect_uri", "https://app.test/api/v1/email-integrations/callback/google")
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    user = User(email="oauth-test@example.com", password_hash="not-a-real-password-hash")
    db.add(user)
    db.commit()

    url = start_oauth(db, user, "google")
    params = parse_qs(urlparse(url).query)
    assert params["code_challenge_method"] == ["S256"]
    assert params["scope"][0].find("gmail.readonly") >= 0
    assert params["scope"][0].find("gmail.send") >= 0
    state_row = db.scalar(select(EmailOAuthState).where(EmailOAuthState.user_id == user.id))
    assert state_row is not None
    assert state_row.state_hash != params["state"][0]
    assert decrypt_token(state_row.code_verifier)
    db.close()
    engine.dispose()

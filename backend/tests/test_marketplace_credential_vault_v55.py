from datetime import datetime, timezone
import pytest
from fastapi import HTTPException
from cryptography.fernet import Fernet
from app.services import marketplace_credentials as vault
from app.models import MarketplaceCredential


def test_encrypt_decrypt_round_trip(monkeypatch):
    key = Fernet.generate_key().decode()
    monkeypatch.setattr(vault.settings, "oauth_encryption_key", key)
    encrypted = vault.encrypt_secret("sample-access-token")
    assert encrypted != "sample-access-token"
    assert vault.decrypt_secret(encrypted) == "sample-access-token"


def test_encryption_fails_closed_without_key(monkeypatch):
    monkeypatch.setattr(vault.settings, "oauth_encryption_key", "")
    with pytest.raises(HTTPException) as exc:
        vault.encrypt_secret("secret")
    assert exc.value.status_code == 503


def test_decryption_fails_closed_with_wrong_key(monkeypatch):
    monkeypatch.setattr(vault.settings, "oauth_encryption_key", Fernet.generate_key().decode())
    encrypted = vault.encrypt_secret("secret")
    monkeypatch.setattr(vault.settings, "oauth_encryption_key", Fernet.generate_key().decode())
    with pytest.raises(HTTPException) as exc:
        vault.decrypt_secret(encrypted)
    assert exc.value.status_code == 503


def test_loaded_tokens_are_decrypted_only_for_internal_service(monkeypatch):
    monkeypatch.setattr(vault.settings, "oauth_encryption_key", Fernet.generate_key().decode())
    row = MarketplaceCredential(user_id="u1", provider="freelancer",
        access_token_encrypted=vault.encrypt_secret("access"),
        refresh_token_encrypted=vault.encrypt_secret("refresh"),
        scopes='["jobs:read"]', status="connected")
    assert vault.load_tokens(row) == {"access_token": "access", "refresh_token": "refresh"}


def test_unsupported_provider_rejected_before_storage():
    with pytest.raises(HTTPException) as exc:
        vault.save_tokens(None, "u1", "linkedin", "secret")
    assert exc.value.status_code == 400

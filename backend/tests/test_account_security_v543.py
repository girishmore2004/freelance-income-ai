from pathlib import Path
from types import SimpleNamespace

from app.services.production_config import validate_production_settings
from app.services.rate_limit import _policy


def _production(**overrides):
    values = {
        "environment": "production",
        "secret_key": "Ab9!kL2@pQ7#vM4$zR8%tY1&nC6*eF3+hJ5=sD0?uW9!bG2@cX7#oP4$",
        "diagnostics_api_key": "",
        "database_url": "postgresql+psycopg://app:password@db.example.test/app",
        "redis_url": "rediss://redis.example.test:6379/0",
        "frontend_url": "https://app.example.test",
        "cors_origins": "https://app.example.test",
        "rate_limit_api_per_minute": 120,
        "rate_limit_auth_per_minute": 10,
        "rate_limit_ai_per_minute": 30,
        "ai_quota_daily_calls": 20,
        "ai_quota_monthly_calls": 300,
        "access_token_expire_minutes": 720,
        "upload_max_mb": 10,
        "ai_provider": "openai",
        "openai_api_key": "server-side-key",
        "openai_base_url": "https://api.groq.com/openai/v1",
        "embedding_provider": "lexical",
        "public_registration": False,
        "require_email_verification": True,
        "smtp_host": "smtp.example.test",
        "smtp_port": 587,
        "smtp_username": "smtp-user",
        "smtp_password": "smtp-password",
        "smtp_from_email": "no-reply@example.test",
        "public_app_url": "https://app.example.test",
        "google_client_id": "", "google_client_secret": "", "google_redirect_uri": "",
        "microsoft_client_id": "", "microsoft_client_secret": "", "microsoft_redirect_uri": "",
        "oauth_encryption_key": "",
        "upwork_client_id": "", "upwork_client_secret": "", "upwork_redirect_uri": "", "upwork_scopes": "",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_production_email_verification_requires_smtp_and_https_frontend():
    good = validate_production_settings(_production())
    assert good["valid"] is True, good["errors"]
    bad = validate_production_settings(_production(smtp_host="", smtp_from_email="", public_app_url="http://localhost:3000"))
    assert bad["valid"] is False
    assert any("SMTP_HOST" in error for error in bad["errors"])
    assert any("PUBLIC_APP_URL" in error for error in bad["errors"])


def test_production_rejects_disabling_email_verification():
    result = validate_production_settings(_production(require_email_verification=False))
    assert result["valid"] is False
    assert any("REQUIRE_EMAIL_VERIFICATION" in error for error in result["errors"])


def test_auth_routes_share_stricter_auth_rate_limit():
    for path in (
        "/api/v1/auth/login", "/api/v1/auth/register",
        "/api/v1/auth/password-reset/request", "/api/v1/auth/password-reset/confirm",
        "/api/v1/auth/verify-email", "/api/v1/auth/resend-verification",
    ):
        assert _policy(path)[2] == "auth"


def test_account_security_routes_and_storage_are_present_and_tokens_are_hashed():
    root = Path(__file__).parents[1]
    main = (root / "app" / "main.py").read_text()
    models = (root / "app" / "models.py").read_text()
    token_service = (root / "app" / "services" / "account_tokens.py").read_text()
    for route in (
        "/api/v1/auth/verify-email", "/api/v1/auth/resend-verification",
        "/api/v1/auth/password-reset/request", "/api/v1/auth/password-reset/confirm",
        "/api/v1/auth/password/change", "/api/v1/auth/sessions",
        "/api/v1/auth/logout", "/api/v1/auth/logout-all",
    ):
        assert route in main
    assert "class AuthSession" in models
    assert "class EmailActionToken" in models
    assert "hashlib.sha256(raw.encode" in token_service
    assert "token_hash" in token_service


def test_security_frontend_includes_password_recovery_and_session_controls():
    root = Path(__file__).parents[2]
    login_page = (root / "frontend" / "app" / "page.tsx").read_text()
    security_page = (root / "frontend" / "app" / "security" / "page.tsx").read_text()
    assert "password-reset/request" in login_page
    assert "verify_token" in login_page
    assert "window.location.hash" in login_page
    assert "password-reset/confirm" in login_page
    assert "logout-all" in security_page
    assert "auth/sessions" in security_page
    assert "password/change" in security_page


def test_migration_preserves_existing_accounts_as_verified_and_adds_session_tables():
    root = Path(__file__).parents[1]
    migration = (root / "alembic" / "versions" / "0044_account_security.py").read_text()
    assert 'revision = "0044_account_security"' in migration
    assert 'down_revision = "0043_archive_bundle_and_supersession"' in migration
    assert 'server_default=sa.true()' in migration
    assert '"auth_sessions"' in migration
    assert '"email_action_tokens"' in migration

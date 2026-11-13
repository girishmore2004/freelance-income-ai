from types import SimpleNamespace

from app.services.production_config import validate_production_settings


def base_settings(**overrides):
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
        "login_failure_limit": 8,
        "login_lockout_minutes": 15,
        "mfa_challenge_minutes": 5,
        "mfa_challenge_max_attempts": 5,
        "ai_provider": "openai",
        "openai_api_key": "server-side-provider-key",
        "openai_base_url": "https://api.groq.com/openai/v1",
        "embedding_provider": "lexical",
        "ollama_base_url": "",
        "public_registration": False,
        "google_client_id": "", "google_client_secret": "", "google_redirect_uri": "",
        "microsoft_client_id": "", "microsoft_client_secret": "", "microsoft_redirect_uri": "",
        "oauth_encryption_key": "",
        "upwork_client_id": "", "upwork_client_secret": "", "upwork_redirect_uri": "", "upwork_scopes": "",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_valid_production_config_with_optional_diagnostics_key_passes():
    result = validate_production_settings(base_settings(diagnostics_api_key="Z9!kL2@pQ7#vM4$zR8%tY1&nC6*eF3+hJ5=sD0?uW9!bG2@cX7#"))
    assert result["valid"] is True, result["errors"]


def test_weak_diagnostics_key_is_rejected():
    result = validate_production_settings(base_settings(diagnostics_api_key="short"))
    assert result["valid"] is False
    assert any("DIAGNOSTICS_API_KEY" in item for item in result["errors"])


def test_non_https_provider_endpoint_and_oauth_callbacks_are_rejected():
    result = validate_production_settings(base_settings(
        openai_base_url="http://provider.example/v1",
        google_client_id="client",
        google_client_secret="secret",
        oauth_encryption_key="fernet-key",
        google_redirect_uri="http://api.example/callback",
    ))
    assert result["valid"] is False
    assert any("OPENAI_BASE_URL" in item for item in result["errors"])
    assert any("GOOGLE_REDIRECT_URI" in item for item in result["errors"])


def test_invalid_token_lifetime_and_upload_limit_are_rejected():
    result = validate_production_settings(base_settings(
        access_token_expire_minutes=0,
        upload_max_mb=1000,
    ))
    assert result["valid"] is False
    assert any("ACCESS_TOKEN_EXPIRE_MINUTES" in item for item in result["errors"])
    assert any("UPLOAD_MAX_MB" in item for item in result["errors"])


def test_authentication_policy_values_are_bounded():
    result = validate_production_settings(base_settings(
        login_failure_limit=1,
        mfa_challenge_minutes=60,
        mfa_challenge_max_attempts=99,
    ))
    assert result["valid"] is False
    assert any("LOGIN_FAILURE_LIMIT" in item for item in result["errors"])
    assert any("MFA_CHALLENGE_MINUTES" in item for item in result["errors"])
    assert any("MFA_CHALLENGE_MAX_ATTEMPTS" in item for item in result["errors"])

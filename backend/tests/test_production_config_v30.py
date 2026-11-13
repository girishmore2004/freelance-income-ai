from types import SimpleNamespace
from app.services.production_config import validate_production_settings


def production_settings(**overrides):
    values = {
        "secret_key": "random-production-secret-value-with-adequate-length-123",
        "database_url": "postgresql+psycopg://user:password@db:5432/app",
        "redis_url": "rediss://redis.example.com:6380/0",
        "frontend_url": "https://app.example.com",
        "cors_origins": "https://app.example.com,https://www.example.com",
        "google_client_id": "",
        "google_client_secret": "",
        "microsoft_client_id": "",
        "microsoft_client_secret": "",
        "oauth_encryption_key": "",
        "public_registration": False,
        "ai_provider": "ollama",
        "ollama_base_url": "https://ollama.example.com",
        "openai_api_key": "",
        "embedding_provider": "ollama",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_valid_production_settings_pass():
    result = validate_production_settings(production_settings())
    assert result["valid"] is True
    assert result["errors"] == []


def test_weak_secret_is_rejected_without_echoing_secret():
    secret = "unsafe-development-secret-change-me"
    result = validate_production_settings(production_settings(secret_key=secret))
    assert result["valid"] is False
    assert any("SECRET_KEY" in error for error in result["errors"])
    assert secret not in str(result)


def test_http_and_wildcard_cors_are_rejected():
    result = validate_production_settings(production_settings(
        frontend_url="http://app.example.com",
        cors_origins="*",
    ))
    assert result["valid"] is False
    assert any("FRONTEND_URL" in error for error in result["errors"])
    assert any("CORS_ORIGINS" in error for error in result["errors"])


def test_non_postgres_database_and_missing_redis_are_rejected():
    result = validate_production_settings(production_settings(
        database_url="sqlite:///./app.db",
        redis_url="",
    ))
    assert result["valid"] is False
    assert any("DATABASE_URL" in error for error in result["errors"])
    assert any("REDIS_URL" in error for error in result["errors"])


def test_oauth_requires_encryption_key_when_enabled():
    result = validate_production_settings(production_settings(
        google_client_id="configured-client-id",
        oauth_encryption_key="",
    ))
    assert result["valid"] is False
    assert any("OAUTH_ENCRYPTION_KEY" in error for error in result["errors"])


def test_public_registration_is_a_warning_not_a_boot_blocker():
    result = validate_production_settings(production_settings(public_registration=True))
    assert result["valid"] is True
    assert any("PUBLIC_REGISTRATION" in warning for warning in result["warnings"])



def test_https_origins_must_not_contain_paths_or_credentials():
    result = validate_production_settings(production_settings(
        frontend_url="https://user:password@app.example.com/dashboard",
        cors_origins="https://app.example.com/api",
    ))
    assert result["valid"] is False
    assert any("FRONTEND_URL" in error for error in result["errors"])
    assert any("CORS_ORIGINS" in error for error in result["errors"])



def test_wildcard_subdomain_is_rejected():
    result = validate_production_settings(production_settings(
        cors_origins="https://*.example.com",
    ))
    assert result["valid"] is False
    assert any("CORS_ORIGINS" in error for error in result["errors"])



def test_frontend_origin_must_be_in_cors_allowlist():
    result = validate_production_settings(production_settings(
        frontend_url="https://app.example.com",
        cors_origins="https://admin.example.com",
    ))
    assert result["valid"] is False
    assert any("listed in CORS_ORIGINS" in error for error in result["errors"])


def test_frontend_url_with_trailing_slash_is_rejected_as_not_an_origin():
    result = validate_production_settings(production_settings(
        frontend_url="https://app.example.com/",
    ))
    assert result["valid"] is False
    assert any("FRONTEND_URL" in error for error in result["errors"])



def test_invalid_rate_limit_values_are_rejected():
    result = validate_production_settings(production_settings(
        rate_limit_api_per_minute=0,
        rate_limit_auth_per_minute="not-a-number",
    ))
    assert result["valid"] is False
    assert any("RATE_LIMIT_API_PER_MINUTE" in error for error in result["errors"])
    assert any("RATE_LIMIT_AUTH_PER_MINUTE" in error for error in result["errors"])


def test_invalid_ai_quota_values_are_rejected():
    result = validate_production_settings(production_settings(
        ai_quota_daily_calls=0,
        ai_quota_monthly_calls="many",
    ))
    assert result["valid"] is False
    assert any("AI_QUOTA_DAILY_CALLS" in error for error in result["errors"])
    assert any("AI_QUOTA_MONTHLY_CALLS" in error for error in result["errors"])

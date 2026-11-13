from types import SimpleNamespace

from app.services.production_config import validate_production_settings


def _settings(**overrides):
    values = {
        "secret_key": "Ab9!kL2@pQ7#vM4$zR8%tY1&nC6*eF3+hJ5=sD0?uW9!bG2@cX7#oP4$" ,
        "database_url": "postgresql+psycopg://app:secret@db.example.test:5432/fia",
        "redis_url": "rediss://redis.example.test:6379/0",
        "frontend_url": "https://app.example.test",
        "cors_origins": "https://app.example.test",
        "rate_limit_api_per_minute": 120,
        "rate_limit_auth_per_minute": 10,
        "rate_limit_ai_per_minute": 30,
        "ai_quota_daily_calls": 20,
        "ai_quota_monthly_calls": 300,
        "google_client_id": "",
        "google_client_secret": "",
        "microsoft_client_id": "",
        "microsoft_client_secret": "",
        "oauth_encryption_key": "",
        "public_registration": False,
        "ai_provider": "ollama",
        "ollama_base_url": "https://ollama.example.test",
        "openai_api_key": "",
        "embedding_provider": "ollama",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_valid_production_configuration_passes_without_echoing_secrets():
    result = validate_production_settings(_settings())
    assert result["valid"] is True
    assert result["errors"] == []
    assert "secret" not in str(result).lower()


def test_production_configuration_rejects_http_and_wildcard_cors():
    result = validate_production_settings(_settings(
        frontend_url="http://app.example.test",
        cors_origins="*",
    ))
    assert result["valid"] is False
    assert any("FRONTEND_URL" in item for item in result["errors"])
    assert any("CORS_ORIGINS" in item for item in result["errors"])


def test_production_configuration_requires_encryption_key_for_oauth():
    result = validate_production_settings(_settings(
        google_client_id="client-id",
        google_client_secret="client-secret",
        oauth_encryption_key="",
    ))
    assert result["valid"] is False
    assert any("OAUTH_ENCRYPTION_KEY" in item for item in result["errors"])


def test_production_configuration_requires_postgres_and_redis():
    result = validate_production_settings(_settings(
        database_url="sqlite:///./app.db",
        redis_url="",
    ))
    assert result["valid"] is False
    assert any("DATABASE_URL" in item for item in result["errors"])
    assert any("REDIS_URL" in item for item in result["errors"])


def test_public_registration_is_a_warning_not_a_secret_or_silent_failure():
    result = validate_production_settings(_settings(public_registration=True))
    assert result["valid"] is True
    assert any("PUBLIC_REGISTRATION" in item for item in result["warnings"])


def test_cloud_production_rejects_default_local_ollama_endpoint():
    result = validate_production_settings(_settings(
        ollama_base_url="http://localhost:11434",
    ))
    assert result["valid"] is False
    assert any("OLLAMA_BASE_URL" in item for item in result["errors"])


def test_openai_provider_requires_server_side_api_key():
    result = validate_production_settings(_settings(
        ai_provider="openai",
        openai_api_key="",
    ))
    assert result["valid"] is False
    assert any("OPENAI_API_KEY" in item for item in result["errors"])


def test_openai_chat_with_ollama_embeddings_still_requires_remote_ollama():
    result = validate_production_settings(_settings(
        ai_provider="openai",
        openai_api_key="server-side-test-key",
        embedding_provider="ollama",
        ollama_base_url="http://127.0.0.1:11434",
    ))
    assert result["valid"] is False
    assert any("OLLAMA_BASE_URL" in item for item in result["errors"])

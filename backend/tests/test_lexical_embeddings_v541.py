import asyncio
from types import SimpleNamespace

import pytest

from app.services import embeddings
from app.services.embeddings import EmbeddingUnavailable
from app.services.production_config import validate_production_settings


def test_lexical_embedding_mode_uses_no_remote_embedding_provider(monkeypatch):
    monkeypatch.setattr(embeddings.settings, "embedding_provider", "lexical")
    with pytest.raises(EmbeddingUnavailable, match="Lexical-only"):
        asyncio.run(embeddings.embed_text("test query"))


def test_production_preflight_accepts_lexical_embeddings_without_ollama_url():
    settings = SimpleNamespace(
        secret_key="Ab9!kL2@pQ7#vM4$zR8%tY1&nC6*eF3+hJ5=sD0?uW9!bG2@cX7#oP4$",
        database_url="postgresql+psycopg://user:pass@db.example/app",
        redis_url="rediss://redis.example:6379/0",
        frontend_url="https://app.example",
        cors_origins="https://app.example",
        rate_limit_api_per_minute=120,
        rate_limit_auth_per_minute=10,
        rate_limit_ai_per_minute=30,
        ai_quota_daily_calls=20,
        ai_quota_monthly_calls=300,
        ai_provider="openai",
        embedding_provider="lexical",
        openai_api_key="provider-key",
        ollama_base_url="",
        google_client_id="", google_client_secret="",
        microsoft_client_id="", microsoft_client_secret="",
        oauth_encryption_key="",
        upwork_client_id="", upwork_client_secret="",
    )
    result = validate_production_settings(settings)
    assert result["valid"] is True, result["errors"]

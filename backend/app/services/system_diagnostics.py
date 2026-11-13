"""Small, deterministic helpers for privacy-safe deployment diagnostics."""


def classify_system_status(database_ok, redis_ok, worker_ok, migration_ok,
                           config_valid, ai_status):
    blockers = []
    warnings = []
    if not database_ok:
        blockers.append("database_unavailable")
    if not redis_ok:
        blockers.append("redis_unavailable")
    if not migration_ok:
        blockers.append("database_migration_mismatch")
    if not config_valid:
        blockers.append("production_configuration_invalid")
    if not worker_ok:
        warnings.append("background_worker_not_healthy")
    if ai_status not in {"healthy", "configured_not_probed", "lexical_only"}:
        warnings.append("ai_provider_not_verified")
    if blockers:
        status = "unhealthy"
    elif warnings:
        status = "degraded"
    else:
        status = "healthy"
    return {"status": status, "blockers": blockers, "warnings": warnings}


def safe_provider_summary(settings):
    """Return configuration presence only; never return keys, URLs or token values."""
    provider = str(getattr(settings, "ai_provider", "unknown") or "unknown").lower()
    embedding = str(getattr(settings, "embedding_provider", "unknown") or "unknown").lower()
    if provider == "openai":
        generation = "configured_not_probed" if getattr(settings, "openai_api_key", "") else "missing_key"
    elif provider == "ollama":
        generation = "requires_runtime_probe"
    else:
        generation = "unsupported"
    if embedding == "lexical":
        embeddings = "lexical_only"
    elif embedding == "openai":
        embeddings = "configured" if getattr(settings, "openai_api_key", "") else "missing_key"
    elif embedding == "ollama":
        embeddings = "requires_runtime_probe"
    else:
        embeddings = "unsupported"
    return {
        "generation_provider": provider,
        "generation_status": generation,
        "embedding_provider": embedding,
        "embedding_status": embeddings,
        "credentials_exposed": False,
    }

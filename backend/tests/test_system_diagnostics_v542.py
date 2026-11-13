from types import SimpleNamespace
from pathlib import Path

from app.services.system_diagnostics import classify_system_status, safe_provider_summary


def test_system_status_reports_healthy_only_when_required_services_are_available():
    result = classify_system_status(True, True, True, True, True, "healthy")
    assert result == {"status": "healthy", "blockers": [], "warnings": []}


def test_system_status_degrades_for_missing_worker_without_marking_api_unhealthy():
    result = classify_system_status(True, True, False, True, True, "configured_not_probed")
    assert result["status"] == "degraded"
    assert "background_worker_not_healthy" in result["warnings"]
    assert result["blockers"] == []


def test_system_status_is_unhealthy_for_database_or_migration_or_config_failure():
    result = classify_system_status(False, True, True, False, False, "healthy")
    assert result["status"] == "unhealthy"
    assert set(result["blockers"]) == {
        "database_unavailable", "database_migration_mismatch",
        "production_configuration_invalid",
    }


def test_provider_summary_never_exposes_api_keys_or_provider_urls():
    settings = SimpleNamespace(
        ai_provider="openai", embedding_provider="lexical",
        openai_api_key="secret-provider-key", openai_base_url="https://provider.example/v1",
    )
    result = safe_provider_summary(settings)
    serialized = str(result)
    assert "secret-provider-key" not in serialized
    assert "provider.example" not in serialized
    assert result["generation_status"] == "configured_not_probed"
    assert result["embedding_status"] == "lexical_only"
    assert result["credentials_exposed"] is False


def test_diagnostics_route_requires_dedicated_header_secret_and_production_readiness_checks_migration():
    root = Path(__file__).parents[1]
    main = (root / "app" / "main.py").read_text()
    assert '@app.get("/api/v1/system/diagnostics")' in main
    assert 'alias="X-Diagnostics-Key"' in main
    assert 'secrets.compare_digest' in main
    assert 'checks["database_migration"]' in main
    assert 'checks["production_configuration"]' in main
    assert '0045_mfa_and_login_lockout' in main


def test_worker_publishes_expiring_multi_instance_heartbeat():
    root = Path(__file__).parents[1]
    worker = (root / "worker.py").read_text()
    assert 'HEARTBEAT_TTL_SECONDS = 90' in worker
    assert 'socket.gethostname()}:{os.getpid()}' in worker
    assert 'connection.set(HEARTBEAT_KEY, payload, ex=HEARTBEAT_TTL_SECONDS)' in worker

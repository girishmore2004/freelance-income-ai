"""Migration 0079: completed agents (trust signals, source terms and takedowns, notification settings, registry)."""
import importlib.util
import pathlib

from app import models

BACKEND = pathlib.Path(__file__).resolve().parents[1]
PATH = BACKEND / "alembic" / "versions" / "0079_agents_complete.py"


def _module():
    spec = importlib.util.spec_from_file_location("m0079", PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


def test_revision_chain():
    m = _module()
    assert m.revision == "0079_agents_complete"
    assert m.down_revision == "0078_fair_proposals_blocks"
    assert len(m.revision) <= 32


def test_every_partial_agent_is_completed_and_none_is_invented():
    m = _module()
    assert sorted(m.COMPLETED) == sorted(["F1", "F3", "F7", "F9", "F11", "C7", "P1", "P5", "P7", "P8", "P9"])
    # Money agents stay blocked until live payments exist.
    assert not {"F10", "P2", "P6"} & set(m.COMPLETED)


def test_models_match_the_migration():
    signals = models.TrustSignal.__table__
    assert {c.name for c in signals.c} == {"id", "user_id", "kind", "context_type", "context_id", "counterpart_user_id", "organization_id", "created_at"}
    assert {fk.parent.name: fk.ondelete for fk in signals.foreign_keys} == {"user_id": "CASCADE", "counterpart_user_id": "SET NULL", "organization_id": "SET NULL"}
    takedowns = models.SourceTakedown.__table__
    assert "uq_source_takedowns_link" in {c.name for c in takedowns.constraints if c.name}
    prefs = models.NotificationPreference.__table__
    assert [c.name for c in prefs.primary_key.columns] == ["user_id", "group_key"]
    sources = models.DiscoverySource.__table__
    assert {"terms_url", "permitted_fields", "reviewed_at", "reviewed_by_user_id"} <= {c.name for c in sources.c}


def test_head_pin():
    assert 'EXPECTED_MIGRATION_HEAD = "0079_agents_complete"' in (BACKEND / "app" / "main.py").read_text()

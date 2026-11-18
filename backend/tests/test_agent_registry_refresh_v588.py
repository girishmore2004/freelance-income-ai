"""Migration 0077: honest registry statuses for agents built since 0058."""
import importlib.util
import pathlib

BACKEND = pathlib.Path(__file__).resolve().parents[1]
PATH = BACKEND / "alembic" / "versions" / "0077_agent_registry_refresh.py"


def _module():
    spec = importlib.util.spec_from_file_location("m0077", PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


def test_only_real_agents_change_and_money_agents_stay_blocked():
    m = _module()
    assert m.down_revision == "0076_hourly_contracts"
    assert set(m.LIVE) == {"F5", "F8", "C4", "P3"}
    assert set(m.PARTIAL) == {"F7", "C7", "P5", "P7", "P9"}
    touched = set(m.LIVE) | set(m.PARTIAL)
    assert not touched & {"F10", "P2", "P6"}, "payment agents stay blocked until live payments exist"
    for names in list(m.LIVE.values()) + list(m.PARTIAL.values()):
        assert names and all(isinstance(n, str) and n for n in names)


def test_head_pin():
    assert 'EXPECTED_MIGRATION_HEAD = "0077_agent_registry_refresh"' in (BACKEND / "app" / "main.py").read_text()

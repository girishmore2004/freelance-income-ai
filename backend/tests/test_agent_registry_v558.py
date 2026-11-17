"""Tests for the governed agent registry (migration 0058)."""
import importlib.util
import pathlib
import sys
import types

if importlib.util.find_spec("pgvector") is None:
    pgvector = types.ModuleType("pgvector")
    sqlalchemy_module = types.ModuleType("pgvector.sqlalchemy")
    from sqlalchemy import Text
    sqlalchemy_module.Vector = lambda *args, **kwargs: Text()
    pgvector.sqlalchemy = sqlalchemy_module
    sys.modules.setdefault("pgvector", pgvector)
    sys.modules.setdefault("pgvector.sqlalchemy", sqlalchemy_module)

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import AgentDefinition, Base

MIGRATION = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0058_agent_registry.py"


def _agents():
    source = MIGRATION.read_text()
    namespace: dict = {}
    exec(compile(source.split("def _tables", 1)[0], str(MIGRATION), "exec"), namespace)
    return namespace["AGENTS"]


def test_catalogue_matches_master_plan_codes():
    codes = [a[0] for a in _agents()]
    assert codes == [f"F{i}" for i in range(1, 13)] + [f"C{i}" for i in range(1, 8)] + [f"P{i}" for i in range(1, 10)]
    assert len(set(codes)) == len(codes)


def test_every_agent_has_a_valid_ceiling_status_and_gate():
    for code, name, side, purpose, ceiling, gate, tools, status, runtime in _agents():
        assert ceiling in {"A0", "A1", "A2", "A3", "A4"}, code
        assert status in {"live", "partial", "planned", "blocked"}, code
        assert side == {"F": "freelancer", "C": "client", "P": "platform"}[code[0]], code
        assert gate and purpose and tools, code
        # Only built agents may claim runtime names.
        if status in {"planned", "blocked"}:
            assert runtime == [], code


def test_money_agents_stay_blocked_and_no_agent_above_a3():
    agents = {a[0]: a for a in _agents()}
    for code in ("F10", "P2", "P6"):
        assert agents[code][7] == "blocked"
    assert all(a[4] != "A4" for a in agents.values())


def test_constraints():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with pytest.raises(IntegrityError):
        with Session(engine) as session:
            session.add(AgentDefinition(code="X1", name="X", side="robot", purpose="p", autonomy_ceiling="A1", human_gate="g", status="live"))
            session.commit()
    with pytest.raises(IntegrityError):
        with Session(engine) as session:
            session.add(AgentDefinition(code="X2", name="X", side="client", purpose="p", autonomy_ceiling="A9", human_gate="g", status="live"))
            session.commit()


def test_0059_marks_built_assistants_live():
    source = (MIGRATION.parent / "0059_assistants_live.py").read_text()
    assert 'down_revision = "0058_agent_registry"' in source
    namespace: dict = {}
    exec(compile(source.split("def upgrade", 1)[0], "0059", "exec"), namespace)
    assert namespace["LIVE"] == {"C3": ["proposal_comparison"], "C5": ["contract_assistant"], "C6": ["acceptance_assistant"]}
    assert "AND status = 'planned'" in source

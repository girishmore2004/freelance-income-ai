"""Schema tests for saved searches (migration 0073)."""
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

from app.models import Base, SavedSearch, User

BACKEND = pathlib.Path(__file__).resolve().parents[1]
MIGRATION = BACKEND / "alembic" / "versions" / "0073_saved_searches.py"


def test_defaults_and_budget_check():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        s.add(User(id="f1", email="f@x.test", password_hash="h"))
        s.flush()
        s.add(SavedSearch(id="S1", user_id="f1", name="Next.js sites"))
        s.commit()
        row = s.get(SavedSearch, "S1")
        assert row.alerts is True and row.skills_json == "[]" and row.query == ""
    with pytest.raises(IntegrityError):
        with Session(engine) as s:
            s.add(SavedSearch(id="S2", user_id="f1", name="x", min_budget_minor=-1))
            s.commit()


def test_migration_chain_and_head():
    assert 'down_revision = "0072_contract_tasks_handover"' in MIGRATION.read_text()
    assert (BACKEND / "alembic" / "versions" / "0074_profile_projects.py").exists()

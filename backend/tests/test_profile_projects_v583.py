"""Schema test for profile projects (migration 0074)."""
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

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.models import Base, Profile, User

BACKEND = pathlib.Path(__file__).resolve().parents[1]
MIGRATION = BACKEND / "alembic" / "versions" / "0074_profile_projects.py"


def test_profile_projects_default_to_an_empty_list():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        s.add(User(id="f1", email="f@x.test", password_hash="h"))
        s.flush()
        s.add(Profile(id="p1", user_id="f1"))
        s.commit()
        assert s.get(Profile, "p1").portfolio_items_json == "[]"


def test_migration_chain_and_head():
    text = MIGRATION.read_text()
    assert 'down_revision = "0073_saved_searches"' in text
    assert "profile_coach" in text
    # Later migrations move the head; the next one must exist.
    assert (BACKEND / "alembic" / "versions" / "0075_services_categories.py").exists()

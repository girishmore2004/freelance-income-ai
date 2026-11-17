"""Schema tests for reports and the moderation log (migration 0060)."""
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

from app.models import Base, Report, User

MIGRATION = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0060_trust_admin.py"


def _engine():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(User(id="u1", email="u@x.test", password_hash="h"))
        session.add(Report(id="r1", reporter_user_id="u1", target_type="listing", target_id="L1", reason="scam"))
        session.commit()
    return engine


def _fails(engine, obj):
    with pytest.raises(IntegrityError):
        with Session(engine) as session:
            session.add(obj)
            session.commit()


def test_one_open_report_per_reporter_and_target():
    engine = _engine()
    _fails(engine, Report(id="r2", reporter_user_id="u1", target_type="listing", target_id="L1", reason="spam"))
    with Session(engine) as session:
        session.add(Report(id="r3", reporter_user_id="u1", target_type="listing", target_id="L1", reason="spam", status="dismissed"))
        session.commit()


def test_report_values_are_constrained():
    engine = _engine()
    _fails(engine, Report(id="r4", reporter_user_id="u1", target_type="planet", target_id="x", reason="spam"))
    _fails(engine, Report(id="r5", reporter_user_id="u1", target_type="user", target_id="x", reason="dislike"))
    _fails(engine, Report(id="r6", reporter_user_id="u1", target_type="user", target_id="y", reason="spam", status="pending"))


def test_migration_installs_the_append_only_guard():
    source = MIGRATION.read_text()
    assert 'down_revision = "0059_assistants_live"' in source
    assert "BEFORE UPDATE OR DELETE ON moderation_actions" in source

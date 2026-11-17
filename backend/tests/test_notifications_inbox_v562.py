"""Schema tests for the notifications inbox (migration 0062)."""
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

from app.models import Base, Notification, User

MIGRATION = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0062_notifications_inbox.py"


def test_dedupe_key_is_unique_and_defaults_apply():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        s.add(User(id="u1", email="u@x.test", password_hash="h"))
        s.add(Notification(id="n1", user_id="u1", title="t", message="m", dedupe_key="k"))
        s.commit()
        assert s.get(Notification, "n1").kind == "general"
    with pytest.raises(IntegrityError):
        with Session(engine) as s:
            s.add(Notification(id="n2", user_id="u1", title="t", message="m", dedupe_key="k"))
            s.commit()


def test_migration_chain():
    assert 'down_revision = "0061_payments_sandbox"' in MIGRATION.read_text()

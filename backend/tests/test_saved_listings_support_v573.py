"""Schema tests for saved projects and support tickets (migration 0068)."""
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

from app.models import Base, Organization, ProjectCategory, ProjectListing, SavedListing, SupportTicket, User

BACKEND = pathlib.Path(__file__).resolve().parents[1]
MIGRATION = BACKEND / "alembic" / "versions" / "0068_saved_listings_support.py"


def _engine():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        s.add_all([User(id="c1", email="c@x.test", password_hash="h"), User(id="f1", email="f@x.test", password_hash="h"),
                   Organization(id="o1", name="Acme", kind="company", created_by="c1"), ProjectCategory(slug="w", name="Web", enabled=True)])
        s.flush()
        s.add(ProjectListing(id="L1", organization_id="o1", created_by="c1", category_slug="w"))
        s.flush()
        s.add(SavedListing(id="S1", user_id="f1", listing_id="L1"))
        s.add(SupportTicket(id="T1", user_id=None, email="v@x.test", topic="payments", subject="Refund", body="How do refunds work?"))
        s.commit()
    return engine


def _fails(engine, obj):
    with pytest.raises(IntegrityError):
        with Session(engine) as s:
            s.add(obj)
            s.commit()


def test_saved_once_and_ticket_values_checked():
    engine = _engine()
    _fails(engine, SavedListing(id="S2", user_id="f1", listing_id="L1"))
    _fails(engine, SupportTicket(id="T2", topic="sales", subject="x", body="y"))
    _fails(engine, SupportTicket(id="T3", topic="other", subject="x", body="y", status="closed"))
    with Session(engine) as s:
        assert s.get(SupportTicket, "T1").status == "open"


def test_migration_chain_and_head():
    assert 'down_revision = "0067_proposal_studio"' in MIGRATION.read_text()
    assert 'EXPECTED_MIGRATION_HEAD = "0068_saved_listings_support"' in (BACKEND / "app" / "main.py").read_text()

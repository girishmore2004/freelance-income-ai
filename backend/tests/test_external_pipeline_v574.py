"""Schema tests for the external application lifecycle (migration 0069)."""
import datetime
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

from app.models import Base, Opportunity, OpportunityEvent, Proposal, ProposalVersion, User

BACKEND = pathlib.Path(__file__).resolve().parents[1]
MIGRATION = BACKEND / "alembic" / "versions" / "0069_external_pipeline.py"


def _engine():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        s.add(User(id="f1", email="f@x.test", password_hash="h"))
        s.flush()
        s.add(Opportunity(id="O1", user_id="f1", source="manual", external_id="x", title="Site", description="d"))
        s.flush()
        s.add(Proposal(id="P1", user_id="f1", opportunity_id="O1", content="Hello"))
        s.flush()
        s.add(ProposalVersion(id="V1", proposal_id="P1", user_id="f1", version=1, content="Hello", source="model"))
        s.add(OpportunityEvent(id="E1", opportunity_id="O1", user_id="f1", kind="follow_up", note="Ping", due_date=datetime.date(2026, 12, 1)))
        s.commit()
    return engine


def _fails(engine, obj):
    with pytest.raises(IntegrityError):
        with Session(engine) as s:
            s.add(obj)
            s.commit()


def test_versions_unique_and_values_checked():
    engine = _engine()
    _fails(engine, ProposalVersion(id="V2", proposal_id="P1", user_id="f1", version=1, content="x", source="edited"))
    _fails(engine, ProposalVersion(id="V3", proposal_id="P1", user_id="f1", version=2, content="x", source="guess"))
    _fails(engine, OpportunityEvent(id="E2", opportunity_id="O1", user_id="f1", kind="payment"))


def test_migration_chain_head_and_backfill():
    text = MIGRATION.read_text()
    assert 'down_revision = "0068_saved_listings_support"' in text
    assert "INSERT INTO proposal_versions" in text
    assert (BACKEND / "alembic" / "versions" / "0070_discussions_interviews.py").exists()  # head moved on to 0070

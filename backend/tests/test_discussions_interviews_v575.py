"""Schema tests for proposal discussions and interviews (migration 0070)."""
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

from app.models import Base, ListingProposal, Organization, ProjectCategory, ProjectListing, ProposalInterview, ProposalMessage, User

BACKEND = pathlib.Path(__file__).resolve().parents[1]
MIGRATION = BACKEND / "alembic" / "versions" / "0070_discussions_interviews.py"
WHEN = datetime.datetime(2026, 12, 1, 10, 0, tzinfo=datetime.timezone.utc)


def _engine():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        s.add_all([User(id="c1", email="c@x.test", password_hash="h"), User(id="f1", email="f@x.test", password_hash="h"),
                   Organization(id="o1", name="Acme", kind="company", created_by="c1"), ProjectCategory(slug="w", name="Web", enabled=True)])
        s.flush()
        s.add(ProjectListing(id="L1", organization_id="o1", created_by="c1", category_slug="w"))
        s.flush()
        s.add(ListingProposal(id="P1", listing_id="L1", freelancer_user_id="f1", price_minor=100))
        s.flush()
        s.add(ProposalMessage(id="M1", proposal_id="P1", sender_user_id="c1", sender_party="client", body="When can you start?"))
        s.add(ProposalInterview(id="I1", proposal_id="P1", proposed_by="c1", proposed_party="client", starts_at=WHEN))
        s.commit()
    return engine


def _fails(engine, obj):
    with pytest.raises(IntegrityError):
        with Session(engine) as s:
            s.add(obj)
            s.commit()


def test_values_are_checked():
    engine = _engine()
    _fails(engine, ProposalMessage(id="M2", proposal_id="P1", sender_party="staff", body="x"))
    _fails(engine, ProposalInterview(id="I2", proposal_id="P1", proposed_party="client", starts_at=WHEN, mode="carrier pigeon"))
    _fails(engine, ProposalInterview(id="I3", proposal_id="P1", proposed_party="client", starts_at=WHEN, duration_minutes=5))
    _fails(engine, ProposalInterview(id="I4", proposal_id="P1", proposed_party="client", starts_at=WHEN, status="maybe"))
    with Session(engine) as s:
        assert s.get(ProposalInterview, "I1").status == "proposed"


def test_migration_chain_and_head():
    assert 'down_revision = "0069_external_pipeline"' in MIGRATION.read_text()
    assert 'EXPECTED_MIGRATION_HEAD = "0070_discussions_interviews"' in (BACKEND / "app" / "main.py").read_text()

"""Schema tests for the delivery workspace (migration 0054)."""
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

from app.models import (
    Base, Contract, ContractEvent, ContractMessage, ListingProposal, MilestoneSubmission, Organization,
    ProjectCategory, ProjectListing, User,
)

MIGRATION = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0054_delivery_workspace.py"


def _engine():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add_all([
            User(id="c1", email="c@x.test", password_hash="h"),
            User(id="f1", email="f@x.test", password_hash="h"),
            Organization(id="o1", name="Acme", kind="company", created_by="c1"),
            ProjectCategory(slug="website_development", name="Website development", enabled=True),
        ])
        session.flush()
        session.add(ProjectListing(id="L1", organization_id="o1", created_by="c1", category_slug="website_development"))
        session.flush()
        session.add(ListingProposal(id="P1", listing_id="L1", freelancer_user_id="f1", price_minor=100))
        session.flush()
        session.add(Contract(id="K1", listing_id="L1", proposal_id="P1", organization_id="o1", freelancer_user_id="f1", status="active"))
        session.flush()
        session.add(MilestoneSubmission(id="S1", contract_id="K1", milestone_index=0, contract_version=1))
        session.commit()
    return engine


def _fails(engine, obj):
    with pytest.raises(IntegrityError):
        with Session(engine) as session:
            session.add(obj)
            session.commit()


def test_one_open_submission_per_milestone():
    engine = _engine()
    _fails(engine, MilestoneSubmission(id="S2", contract_id="K1", milestone_index=0, contract_version=1))
    with Session(engine) as session:
        session.add(MilestoneSubmission(id="S3", contract_id="K1", milestone_index=0, contract_version=1, status="approved"))
        session.add(MilestoneSubmission(id="S4", contract_id="K1", milestone_index=1, contract_version=1))
        session.commit()


def test_status_index_and_party_are_constrained():
    engine = _engine()
    _fails(engine, MilestoneSubmission(id="S5", contract_id="K1", milestone_index=2, contract_version=1, status="paid"))
    _fails(engine, MilestoneSubmission(id="S6", contract_id="K1", milestone_index=25, contract_version=1))
    _fails(engine, ContractMessage(id="M1", contract_id="K1", sender_party="admin", body="hi"))
    _fails(engine, ContractEvent(id="E1", contract_id="K1", actor_party="bot", event_type="x"))


def test_migration_chain():
    source = MIGRATION.read_text()
    assert 'down_revision = "0053_proposals_contracts"' in source
    assert len("0054_delivery_workspace") <= 32

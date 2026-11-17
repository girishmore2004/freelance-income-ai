"""Schema tests for proposals and two-party contracts (migration 0053)."""
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
    Base, Contract, ContractVersion, ListingProposal, Organization, ProjectCategory, ProjectListing, User,
)

MIGRATION = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0053_proposals_contracts.py"


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
        session.add(ListingProposal(id="P1", listing_id="L1", freelancer_user_id="f1", price_minor=5_000_000))
        session.flush()
        session.add(Contract(id="K1", listing_id="L1", proposal_id="P1", organization_id="o1", freelancer_user_id="f1"))
        session.flush()
        session.add(ContractVersion(contract_id="K1", version=1, title="Shop", total_minor=5_000_000, content_hash="h", proposed_by="client"))
        session.commit()
    return engine


def _fails(engine, obj):
    with pytest.raises(IntegrityError):
        with Session(engine) as session:
            session.add(obj)
            session.commit()


def test_one_proposal_per_freelancer_and_positive_price():
    engine = _engine()
    _fails(engine, ListingProposal(id="P2", listing_id="L1", freelancer_user_id="f1", price_minor=100))
    with Session(engine) as session:
        session.add(User(id="f2", email="f2@x.test", password_hash="h"))
        session.commit()
    _fails(engine, ListingProposal(id="P3", listing_id="L1", freelancer_user_id="f2", price_minor=0))
    _fails(engine, ListingProposal(id="P4", listing_id="L1", freelancer_user_id="f2", price_minor=100, status="maybe"))


def test_only_one_open_contract_per_proposal():
    engine = _engine()
    _fails(engine, Contract(id="K2", listing_id="L1", proposal_id="P1", organization_id="o1", freelancer_user_id="f1"))
    with Session(engine) as session:
        session.add(Contract(id="K3", listing_id="L1", proposal_id="P1", organization_id="o1", freelancer_user_id="f1", status="withdrawn"))
        session.commit()


def test_contract_versions_are_unique_and_constrained():
    engine = _engine()
    _fails(engine, ContractVersion(contract_id="K1", version=1, title="Again", total_minor=1, content_hash="h", proposed_by="client"))
    _fails(engine, ContractVersion(contract_id="K1", version=2, title="Zero", total_minor=0, content_hash="h", proposed_by="client"))
    _fails(engine, ContractVersion(contract_id="K1", version=3, title="Who", total_minor=1, content_hash="h", proposed_by="platform"))


def test_migration_chain_and_restrictive_contract_references():
    source = MIGRATION.read_text()
    assert 'down_revision = "0052_invites_saved_freelancers"' in source
    assert len("0053_proposals_contracts") <= 32
    assert source.count('ondelete="RESTRICT"') == 4

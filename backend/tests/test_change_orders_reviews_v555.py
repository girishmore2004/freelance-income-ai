"""Schema tests for change orders and reviews (migration 0055)."""
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

from app.models import Base, Contract, ContractReview, ListingProposal, Organization, ProjectCategory, ProjectListing, User

MIGRATION = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0055_change_orders_reviews.py"


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
        session.add(Contract(id="K1", listing_id="L1", proposal_id="P1", organization_id="o1", freelancer_user_id="f1", status="completed", agreed_version=1))
        session.flush()
        session.add(ContractReview(id="R1", contract_id="K1", reviewer_party="client", rating=5))
        session.commit()
    return engine


def _fails(engine, obj):
    with pytest.raises(IntegrityError):
        with Session(engine) as session:
            session.add(obj)
            session.commit()


def test_one_review_per_party_with_rating_1_to_5():
    engine = _engine()
    _fails(engine, ContractReview(id="R2", contract_id="K1", reviewer_party="client", rating=4))
    _fails(engine, ContractReview(id="R3", contract_id="K1", reviewer_party="freelancer", rating=6))
    _fails(engine, ContractReview(id="R4", contract_id="K1", reviewer_party="admin", rating=3))
    with Session(engine) as session:
        session.add(ContractReview(id="R5", contract_id="K1", reviewer_party="freelancer", rating=4))
        session.commit()


def test_migration_chain_and_backfill():
    source = MIGRATION.read_text()
    assert 'down_revision = "0054_delivery_workspace"' in source
    assert "SET agreed_version = current_version" in source
    assert len("0055_change_orders_reviews") <= 32

"""Schema tests for disputes and suspensions (migration 0063)."""
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

from app.models import AccountSuspension, Base, Contract, Dispute, ListingProposal, Organization, ProjectCategory, ProjectListing, User

MIGRATION = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0063_disputes_suspensions.py"


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
        s.add(Contract(id="K1", listing_id="L1", proposal_id="P1", organization_id="o1", freelancer_user_id="f1", status="active"))
        s.flush()
        s.add(Dispute(id="D1", contract_id="K1", opened_by_party="client", reason="quality", description="d"))
        s.add(AccountSuspension(id="S1", user_id="f1", reason="r"))
        s.commit()
    return engine


def _fails(engine, obj):
    with pytest.raises(IntegrityError):
        with Session(engine) as s:
            s.add(obj)
            s.commit()


def test_one_open_dispute_and_one_active_suspension():
    engine = _engine()
    _fails(engine, Dispute(id="D2", contract_id="K1", opened_by_party="freelancer", reason="payment", description="d"))
    _fails(engine, AccountSuspension(id="S2", user_id="f1", reason="again"))


def test_values_are_constrained():
    engine = _engine()
    _fails(engine, Dispute(id="D3", contract_id="K1", opened_by_party="client", reason="anger", description="d", status="withdrawn"))
    _fails(engine, Dispute(id="D4", contract_id="K1", opened_by_party="client", reason="quality", description="d", status="resolved", resolution="split"))


def test_migration_chain():
    assert 'down_revision = "0062_notifications_inbox"' in MIGRATION.read_text()

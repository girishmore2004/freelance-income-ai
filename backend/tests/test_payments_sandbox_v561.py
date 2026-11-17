"""Schema tests for the payment flow records (migration 0061)."""
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
    Base, Contract, FeeSchedule, ListingProposal, Organization, PaymentEvent, PaymentIntent, Payout,
    ProjectCategory, ProjectListing, User,
)

MIGRATION = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0061_payments_sandbox.py"


def _engine():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        s.add_all([User(id="c1", email="c@x.test", password_hash="h"), User(id="f1", email="f@x.test", password_hash="h"),
                   Organization(id="o1", name="Acme", kind="company", created_by="c1"),
                   ProjectCategory(slug="website_development", name="Web", enabled=True),
                   FeeSchedule(id="F1", name="Test", currency="INR", client_fee_bps=350, freelancer_fee_bps=250, status="approved")])
        s.flush()
        s.add(ProjectListing(id="L1", organization_id="o1", created_by="c1", category_slug="website_development"))
        s.flush()
        s.add(ListingProposal(id="P1", listing_id="L1", freelancer_user_id="f1", price_minor=100))
        s.flush()
        s.add(Contract(id="K1", listing_id="L1", proposal_id="P1", organization_id="o1", freelancer_user_id="f1", status="active"))
        s.flush()
        s.add(_intent("I1", "k1", "ref1"))
        s.commit()
    return engine


def _intent(id_, key, ref, **kw):
    values = dict(id=id_, contract_id="K1", milestone_index=0, contract_version=1, amount_minor=10000, client_fee_minor=350,
                  freelancer_fee_minor=250, total_minor=10350, currency="INR", fee_schedule_id="F1", provider="sandbox",
                  provider_ref=ref, mode="sandbox", idempotency_key=key)
    values.update(kw)
    return PaymentIntent(**values)


def _fails(engine, obj):
    with pytest.raises(IntegrityError):
        with Session(engine) as s:
            s.add(obj)
            s.commit()


def test_one_open_funding_per_milestone():
    engine = _engine()
    _fails(engine, _intent("I2", "k2", "ref2"))
    with Session(engine) as s:
        s.add(_intent("I3", "k3", "ref3", status="refunded"))
        s.commit()


def test_amounts_must_add_up_and_mode_is_constrained():
    engine = _engine()
    _fails(engine, _intent("I4", "k4", "ref4", milestone_index=1, total_minor=999))
    _fails(engine, _intent("I5", "k5", "ref5", milestone_index=2, mode="real"))
    _fails(engine, _intent("I6", "k6", "ref6", milestone_index=3, freelancer_fee_minor=20000))


def test_events_and_payouts_are_idempotent():
    engine = _engine()
    with Session(engine) as s:
        s.add(PaymentEvent(id="E1", provider="sandbox", event_id="ev1", event_type="x", payload_json="{}", signature_valid=True, source="sandbox"))
        s.add(Payout(id="PO1", user_id="f1", amount_minor=100, currency="INR", provider="sandbox", mode="sandbox", idempotency_key="p1"))
        s.commit()
    _fails(engine, PaymentEvent(id="E2", provider="sandbox", event_id="ev1", event_type="x", payload_json="{}", signature_valid=True, source="sandbox"))
    _fails(engine, Payout(id="PO2", user_id="f1", amount_minor=100, currency="INR", provider="sandbox", mode="sandbox", idempotency_key="p1"))


def test_migration_seeds_flags_off():
    source = MIGRATION.read_text()
    assert 'down_revision = "0060_trust_admin"' in source
    namespace: dict = {}
    exec(compile(source.split("def _tables", 1)[0], str(MIGRATION), "exec"), namespace)
    assert namespace["FLAGS"] == [
        ("payments.sandbox", False, "Test-mode money loop with the sandbox provider (no real money).", "founder"),
        ("payments.require_funding", False, "Freelancers can deliver a milestone only after it is funded (D-3).", "founder"),
    ]

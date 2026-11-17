"""Schema tests for the ledger foundation (migration 0056)."""
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

from app.models import Base, FeeSchedule, LedgerAccount, LedgerEntry, LedgerLine

MIGRATION = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0056_ledger_foundation.py"


def _engine():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(LedgerAccount(id="A1", code="platform:revenue:fees", name="Fees", kind="revenue", currency="INR"))
        session.add(LedgerEntry(id="E1", idempotency_key="k1", entry_type="test", mode="sandbox"))
        session.commit()
    return engine


def _fails(engine, obj):
    with pytest.raises(IntegrityError):
        with Session(engine) as session:
            session.add(obj)
            session.commit()


def test_accounts_entries_and_lines_are_constrained():
    engine = _engine()
    _fails(engine, LedgerAccount(id="A2", code="platform:revenue:fees", name="Dup", kind="revenue", currency="INR"))
    _fails(engine, LedgerAccount(id="A3", code="x", name="Bad", kind="income", currency="INR"))
    _fails(engine, LedgerEntry(id="E2", idempotency_key="k1", entry_type="dup", mode="sandbox"))
    _fails(engine, LedgerEntry(id="E3", idempotency_key="k3", entry_type="x", mode="pretend"))
    _fails(engine, LedgerLine(id="L1", entry_id="E1", account_id="A1", direction="debit", amount_minor=0, currency="INR"))
    _fails(engine, LedgerLine(id="L2", entry_id="E1", account_id="A1", direction="up", amount_minor=5, currency="INR"))


def test_fee_schedules_are_bounded():
    engine = _engine()
    _fails(engine, FeeSchedule(id="F1", name="Too high", currency="INR", client_fee_bps=5000, freelancer_fee_bps=0))
    _fails(engine, FeeSchedule(id="F2", name="Bad status", currency="INR", client_fee_bps=0, freelancer_fee_bps=0, status="live"))


def test_migration_installs_postgres_guards_and_seeds_no_fees():
    source = MIGRATION.read_text()
    assert 'down_revision = "0055_change_orders_reviews"' in source
    assert "CREATE CONSTRAINT TRIGGER ledger_lines_balanced" in source
    assert "DEFERRABLE INITIALLY DEFERRED" in source
    assert "BEFORE UPDATE OR DELETE ON ledger_entries" in source
    assert "INSERT INTO fee_schedules" not in source
    assert len("0056_ledger_foundation") <= 32

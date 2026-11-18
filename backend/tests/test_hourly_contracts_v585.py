"""Schema tests for hourly contracts (migration 0076)."""
import datetime as dt
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

from app.models import Base, Contract, ContractTimeEntry, ContractTimesheet, Organization, User

BACKEND = pathlib.Path(__file__).resolve().parents[1]
WEEK = dt.date(2026, 11, 16)


def _engine():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        s.add_all([User(id="c1", email="c@x.test", password_hash="h"), User(id="f1", email="f@x.test", password_hash="h"),
                   Organization(id="o1", name="Acme", kind="company", created_by="c1")])
        s.flush()
        s.add(Contract(id="K1", organization_id="o1", freelancer_user_id="f1", status="active"))
        s.commit()
    return engine


def _fails(engine, row):
    with Session(engine) as s:
        s.add(row)
        with pytest.raises(IntegrityError):
            s.commit()


def test_one_timesheet_per_week_with_entries():
    engine = _engine()
    with Session(engine) as s:
        s.add(ContractTimesheet(id="T1", contract_id="K1", week_start=WEEK, rate_minor=80000))
        s.flush()
        s.add(ContractTimeEntry(id="E1", contract_id="K1", timesheet_id="T1", work_date=WEEK, minutes=90, description="Homepage build"))
        s.commit()
        assert s.get(ContractTimesheet, "T1").status == "open"
    _fails(engine, ContractTimesheet(id="T2", contract_id="K1", week_start=WEEK, rate_minor=80000))


def test_constraints():
    engine = _engine()
    _fails(engine, ContractTimesheet(id="T3", contract_id="K1", week_start=WEEK, rate_minor=0))
    _fails(engine, ContractTimesheet(id="T4", contract_id="K1", week_start=WEEK, rate_minor=100, status="rejected"))
    with Session(engine) as s:
        s.add(ContractTimesheet(id="T5", contract_id="K1", week_start=WEEK, rate_minor=100))
        s.commit()
    _fails(engine, ContractTimeEntry(id="E2", contract_id="K1", timesheet_id="T5", work_date=WEEK, minutes=0, description="x"))
    _fails(engine, ContractTimeEntry(id="E3", contract_id="K1", timesheet_id="T5", work_date=WEEK, minutes=1441, description="x"))


def test_migration_chain_and_head():
    text = (BACKEND / "alembic" / "versions" / "0076_hourly_contracts.py").read_text()
    assert 'down_revision = "0075_services_categories"' in text
    assert 'EXPECTED_MIGRATION_HEAD = "0076_hourly_contracts"' in (BACKEND / "app" / "main.py").read_text()

"""Schema tests for contract tasks and handover items (migration 0072)."""
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

from app.models import (Base, Contract, ContractHandoverItem, ContractTask, ListingProposal, Organization, ProjectCategory,
                        ProjectListing, User)

BACKEND = pathlib.Path(__file__).resolve().parents[1]
MIGRATION = BACKEND / "alembic" / "versions" / "0072_contract_tasks_handover.py"


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
        s.add(ContractTask(id="T1", contract_id="K1", title="Set up staging"))
        s.add(ContractHandoverItem(id="H1", contract_id="K1", kind="source_files", title="Repository"))
        s.commit()
    return engine


def _fails(engine, obj):
    with pytest.raises(IntegrityError):
        with Session(engine) as s:
            s.add(obj)
            s.commit()


def test_values_are_checked():
    engine = _engine()
    _fails(engine, ContractTask(id="T2", contract_id="K1", title="x", status="blocked"))
    _fails(engine, ContractTask(id="T3", contract_id="K1", title="x", owner_party="staff"))
    _fails(engine, ContractTask(id="T4", contract_id="K1", title="x", milestone_index=-1))
    _fails(engine, ContractHandoverItem(id="H2", contract_id="K1", kind="passwords", title="x"))
    with Session(engine) as s:
        assert s.get(ContractTask, "T1").status == "todo"
        assert s.get(ContractHandoverItem, "H1").status == "pending"


def test_migration_chain_and_head():
    assert 'down_revision = "0071_files_verification_sources"' in MIGRATION.read_text()
    assert len("0072_contract_tasks_handover") <= 32
    assert (BACKEND / "alembic" / "versions" / "0073_saved_searches.py").exists()

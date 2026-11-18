"""Schema tests for contract file attachments (migration 0065)."""
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

from app.models import Base, Contract, ContractFile, ListingProposal, Organization, ProjectCategory, ProjectListing, User

MIGRATION = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0065_contract_files.py"


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
        s.add(ContractFile(id="F1", contract_id="K1", uploaded_by="f1", party="freelancer", r2_key="contracts/K1/F1", filename="a.pdf",
                           content_type="application/pdf", size_bytes=10, sha256="0" * 64))
        s.commit()
    return engine


def _fails(engine, obj):
    with pytest.raises(IntegrityError):
        with Session(engine) as s:
            s.add(obj)
            s.commit()


def test_keys_are_unique_and_values_constrained():
    engine = _engine()
    _fails(engine, ContractFile(id="F2", contract_id="K1", party="freelancer", r2_key="contracts/K1/F1", filename="b.pdf", content_type="application/pdf", size_bytes=1, sha256="1" * 64))
    _fails(engine, ContractFile(id="F3", contract_id="K1", party="staff", r2_key="contracts/K1/F3", filename="b.pdf", content_type="application/pdf", size_bytes=1, sha256="1" * 64))
    _fails(engine, ContractFile(id="F4", contract_id="K1", party="client", r2_key="contracts/K1/F4", filename="b.pdf", content_type="application/pdf", size_bytes=0, sha256="1" * 64))


def test_migration_chain():
    assert 'down_revision = "0064_org_invitations"' in MIGRATION.read_text()

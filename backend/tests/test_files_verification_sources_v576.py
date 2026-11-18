"""Schema tests for listing files, verification requests and discovery sources (migration 0071)."""
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

from app.models import Base, DiscoverySource, DiscoverySourceRun, ListingFile, Organization, ProjectCategory, ProjectListing, User, VerificationRequest

BACKEND = pathlib.Path(__file__).resolve().parents[1]
MIGRATION = BACKEND / "alembic" / "versions" / "0071_files_verification_sources.py"


def _engine():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        s.add_all([User(id="c1", email="c@x.test", password_hash="h"), Organization(id="o1", name="Acme", kind="company", created_by="c1"),
                   ProjectCategory(slug="w", name="Web", enabled=True)])
        s.flush()
        s.add(ProjectListing(id="L1", organization_id="o1", created_by="c1", category_slug="w"))
        s.add(VerificationRequest(id="V1", subject_type="client", subject_id="o1", requested_by="c1"))
        s.add(DiscoverySource(code="remotive"))
        s.commit()
    return engine


def _fails(engine, obj):
    with pytest.raises(IntegrityError):
        with Session(engine) as s:
            s.add(obj)
            s.commit()


def test_values_are_checked():
    engine = _engine()
    _fails(engine, ListingFile(id="F1", listing_id="L1", r2_key="k", filename="a.pdf", content_type="application/pdf", size_bytes=0, sha256="x"))
    _fails(engine, VerificationRequest(id="V2", subject_type="client", subject_id="o1"))  # second pending request
    _fails(engine, VerificationRequest(id="V3", subject_type="robot", subject_id="o1", status="approved"))
    _fails(engine, DiscoverySourceRun(id="R1", source="remotive", fetched=-1))
    with Session(engine) as s:
        s.add(VerificationRequest(id="V4", subject_type="client", subject_id="o1", status="rejected"))
        s.commit()
        assert s.get(DiscoverySource, "remotive").enabled is True


def test_migration_chain_and_head():
    text = MIGRATION.read_text()
    assert 'down_revision = "0070_discussions_interviews"' in text
    assert len("0071_files_verification_sources") <= 32
    assert 'EXPECTED_MIGRATION_HEAD = "0071_files_verification_sources"' in (BACKEND / "app" / "main.py").read_text()

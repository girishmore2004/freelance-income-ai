"""Schema tests for the Proposal Studio (migration 0067)."""
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

from app.models import Base, ListingProposal, ListingProposalVersion, Organization, ProjectCategory, ProjectListing, User

BACKEND = pathlib.Path(__file__).resolve().parents[1]
MIGRATION = BACKEND / "alembic" / "versions" / "0067_proposal_studio.py"


def _engine():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        s.add_all([User(id="c1", email="c@x.test", password_hash="h"), User(id="f1", email="f@x.test", password_hash="h"),
                   Organization(id="o1", name="Acme", kind="company", created_by="c1"), ProjectCategory(slug="w", name="Web", enabled=True)])
        s.flush()
        s.add(ProjectListing(id="L1", organization_id="o1", created_by="c1", category_slug="w"))
        s.flush()
        s.add(ListingProposal(id="P1", listing_id="L1", freelancer_user_id="f1", price_minor=100,
                              sections_json={"approach": "Plan", "deliverables": ["Site"]}, content_hash="a" * 64))
        s.flush()
        s.add(ListingProposalVersion(id="V1", proposal_id="P1", version=1, cover_letter="x", price_minor=100, created_by="f1"))
        s.commit()
    return engine


def _fails(engine, obj):
    with pytest.raises(IntegrityError):
        with Session(engine) as s:
            s.add(obj)
            s.commit()


def test_versions_are_unique_and_positive():
    engine = _engine()
    _fails(engine, ListingProposalVersion(id="V2", proposal_id="P1", version=1, cover_letter="y", price_minor=100))
    _fails(engine, ListingProposalVersion(id="V3", proposal_id="P1", version=0, cover_letter="y", price_minor=100))
    _fails(engine, ListingProposalVersion(id="V4", proposal_id="P1", version=2, cover_letter="y", price_minor=0))
    with Session(engine) as s:
        s.add(ListingProposalVersion(id="V5", proposal_id="P1", version=2, cover_letter="y", price_minor=120))
        s.commit()
        p = s.get(ListingProposal, "P1")
        assert p.current_version == 1
        assert p.sections_json["deliverables"] == ["Site"]


def test_migration_chain_and_head():
    text = MIGRATION.read_text()
    assert 'down_revision = "0066_business_coach_partial"' in text
    assert "INSERT INTO listing_proposal_versions" in text  # existing proposals are backfilled as version 1
    assert (BACKEND / "alembic" / "versions" / "0068_saved_listings_support.py").exists()  # head moved on to 0068

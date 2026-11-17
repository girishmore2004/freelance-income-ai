"""Schema tests for invitations, saved freelancers and the profile opt-in (migration 0052)."""
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
    Base, ListingInvitation, Organization, Profile, ProjectCategory, ProjectListing, SavedFreelancer, User,
)

MIGRATION = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0052_invites_saved_freelancers.py"


def _engine():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(User(id="c1", email="c@x.test", password_hash="h"))
        session.add(User(id="f1", email="f@x.test", password_hash="h"))
        session.add(Organization(id="o1", name="Acme", kind="company", created_by="c1"))
        session.add(ProjectCategory(slug="website_development", name="Website development", enabled=True))
        session.add(ProjectListing(id="L1", organization_id="o1", created_by="c1", category_slug="website_development"))
        session.add(ListingInvitation(id="i1", listing_id="L1", freelancer_user_id="f1", invited_by="c1"))
        session.add(SavedFreelancer(id="s1", organization_id="o1", freelancer_user_id="f1", saved_by="c1"))
        session.commit()
    return engine


def _fails(engine, obj):
    with pytest.raises(IntegrityError):
        with Session(engine) as session:
            session.add(obj)
            session.commit()


def test_one_invitation_per_listing_and_freelancer():
    _fails(_engine(), ListingInvitation(id="i2", listing_id="L1", freelancer_user_id="f1"))


def test_invitation_status_is_constrained():
    engine = _engine()
    with Session(engine) as session:
        session.add(User(id="f2", email="f2@x.test", password_hash="h"))
        session.commit()
    _fails(engine, ListingInvitation(id="i3", listing_id="L1", freelancer_user_id="f2", status="maybe"))


def test_saved_freelancer_is_unique_per_organisation():
    _fails(_engine(), SavedFreelancer(id="s2", organization_id="o1", freelancer_user_id="f1"))


def test_profiles_are_not_visible_by_default():
    engine = _engine()
    with Session(engine) as session:
        session.add(Profile(id="p1", user_id="f1"))
        session.commit()
        assert session.get(Profile, "p1").marketplace_visible is False


def test_migration_chain():
    source = MIGRATION.read_text()
    assert 'down_revision = "0051_native_project_listings"' in source
    assert "server_default=sa.false()" in source

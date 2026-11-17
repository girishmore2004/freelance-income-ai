"""Schema tests for native project listings (migration 0051)."""
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

from app.models import Base, Organization, ProjectCategory, ProjectListing, ProjectListingVersion, User

MIGRATION = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0051_native_project_listings.py"


def _engine():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(User(id="u1", email="c@x.test", password_hash="h"))
        session.add(Organization(id="o1", name="Acme", kind="company", created_by="u1"))
        session.add(ProjectCategory(slug="website_development", name="Website development", enabled=True))
        session.add(ProjectListing(id="L1", organization_id="o1", created_by="u1", category_slug="website_development"))
        session.add(ProjectListingVersion(listing_id="L1", version=1, title="Shop", category_slug="website_development", content_hash="h"))
        session.commit()
    return engine


def _fails(engine, obj):
    with pytest.raises(IntegrityError):
        with Session(engine) as session:
            session.add(obj)
            session.commit()


def test_versions_are_unique_per_listing():
    _fails(_engine(), ProjectListingVersion(listing_id="L1", version=1, title="Again", category_slug="website_development", content_hash="h2"))


def test_budget_range_status_and_visibility_are_constrained():
    engine = _engine()
    _fails(engine, ProjectListingVersion(listing_id="L1", version=2, title="Bad", category_slug="website_development", content_hash="h", budget_min_minor=500, budget_max_minor=100))
    _fails(engine, ProjectListing(id="L2", organization_id="o1", category_slug="website_development", status="live"))
    _fails(engine, ProjectListing(id="L3", organization_id="o1", category_slug="website_development", visibility="everyone"))


def test_migration_seeds_categories_with_only_website_development_enabled():
    source = MIGRATION.read_text()
    assert 'down_revision = "0050_identity_roles_orgs"' in source
    namespace: dict = {}
    exec(compile(source.split("def _tables", 1)[0], str(MIGRATION), "exec"), namespace)
    categories = namespace["CATEGORIES"]
    assert [c["slug"] for c in categories if c["enabled"]] == ["website_development"]
    for category in categories:
        assert category["template"]["stages"], category["slug"]
        assert category["template"]["acceptance"], category["slug"]

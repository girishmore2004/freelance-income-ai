"""Schema tests for roles, organisations and memberships (migration 0050)."""
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
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Base, Organization, OrganizationMembership, User, UserRole

MIGRATION = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0050_identity_roles_orgs.py"


def _engine():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add_all([User(id="u1", email="a@x.test", password_hash="h"), User(id="u2", email="b@x.test", password_hash="h")])
        session.commit()
    return engine


def test_a_user_can_hold_both_public_roles_once_each():
    engine = _engine()
    with Session(engine) as session:
        session.add_all([UserRole(user_id="u1", role="freelancer"), UserRole(user_id="u1", role="client")])
        session.commit()
    with pytest.raises(IntegrityError):
        with Session(engine) as session:
            session.add(UserRole(user_id="u1", role="client"))
            session.commit()


def test_unknown_roles_are_rejected_by_the_database():
    engine = _engine()
    with pytest.raises(IntegrityError):
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO user_roles (id, user_id, role, status, granted_by) VALUES ('r', 'u1', 'superuser', 'active', 'self')"))


def test_organisation_kind_and_membership_role_are_constrained():
    engine = _engine()
    with Session(engine) as session:
        session.add(Organization(id="o1", name="Acme", kind="company", created_by="u1"))
        session.add(OrganizationMembership(organization_id="o1", user_id="u1", role="owner"))
        session.commit()
    with pytest.raises(IntegrityError):
        with Session(engine) as session:
            session.add(Organization(id="o2", name="Bad", kind="government", created_by="u1"))
            session.commit()
    with pytest.raises(IntegrityError):
        with Session(engine) as session:
            session.add(OrganizationMembership(organization_id="o1", user_id="u2", role="emperor"))
            session.commit()


def test_migration_backfills_freelancer_role_and_chains_after_0049():
    source = MIGRATION.read_text()
    assert 'down_revision = "0049_feature_flags_ai_cost"' in source
    assert "'freelancer', 'active', 'migration-0050'" in source
    assert 'ondelete="SET NULL"' in source, "deleting an account must not be blocked by organisations it created"

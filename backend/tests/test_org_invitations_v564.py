"""Schema tests for organisation invitations (migration 0064)."""
import importlib.util
import pathlib
import sys
import types
from datetime import datetime, timedelta, timezone

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

from app.models import Base, Organization, OrganizationInvitation, User

MIGRATION = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0064_org_invitations.py"
LATER = datetime.now(timezone.utc) + timedelta(days=7)


def _engine():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        s.add_all([User(id="c1", email="c@x.test", password_hash="h"), Organization(id="o1", name="Acme", kind="company", created_by="c1")])
        s.flush()
        s.add(OrganizationInvitation(id="I1", organization_id="o1", email="a@x.test", role="member", token_hash="a" * 64, expires_at=LATER))
        s.commit()
    return engine


def _fails(engine, obj):
    with pytest.raises(IntegrityError):
        with Session(engine) as s:
            s.add(obj)
            s.commit()


def test_one_pending_invitation_per_email_and_unique_tokens():
    engine = _engine()
    _fails(engine, OrganizationInvitation(id="I2", organization_id="o1", email="a@x.test", role="admin", token_hash="b" * 64, expires_at=LATER))
    _fails(engine, OrganizationInvitation(id="I3", organization_id="o1", email="b@x.test", role="member", token_hash="a" * 64, expires_at=LATER))
    with Session(engine) as s:
        s.add(OrganizationInvitation(id="I4", organization_id="o1", email="a@x.test", role="member", token_hash="c" * 64, status="revoked", expires_at=LATER))
        s.commit()


def test_owner_cannot_be_invited():
    _fails(_engine(), OrganizationInvitation(id="I5", organization_id="o1", email="o@x.test", role="owner", token_hash="d" * 64, expires_at=LATER))


def test_migration_chain():
    assert 'down_revision = "0063_disputes_suspensions"' in MIGRATION.read_text()

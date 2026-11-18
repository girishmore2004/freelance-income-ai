"""Schema tests for the service catalogue and open categories (migration 0075)."""
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

from app.models import Base, Contract, Organization, ProjectCategory, Report, Service, ServiceOrder, User

BACKEND = pathlib.Path(__file__).resolve().parents[1]
MIGRATION = BACKEND / "alembic" / "versions" / "0075_services_categories.py"


def _engine():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        s.add_all([
            User(id="c1", email="c@x.test", password_hash="h"),
            User(id="f1", email="f@x.test", password_hash="h"),
            Organization(id="o1", name="Acme", kind="company", created_by="c1"),
            ProjectCategory(slug="graphic_design", name="Graphic design", enabled=True),
        ])
        s.commit()
    return engine


def _fails(engine, row):
    with Session(engine) as s:
        s.add(row)
        with pytest.raises(IntegrityError):
            s.commit()


def test_service_order_creates_a_contract_without_a_project():
    engine = _engine()
    with Session(engine) as s:
        s.add(Service(id="S1", freelancer_user_id="f1", category_slug="graphic_design", title="Logo design", min_price_minor=150000, status="published"))
        s.add(Contract(id="K1", organization_id="o1", freelancer_user_id="f1"))
        s.flush()
        s.add(ServiceOrder(id="SO1", service_id="S1", contract_id="K1", organization_id="o1", client_user_id="c1", freelancer_user_id="f1",
                           package_key="basic", price_minor=150000, delivery_days=3))
        s.commit()
        assert s.get(Contract, "K1").listing_id is None
        assert s.get(Service, "S1").packages_json == "[]"


def test_constraints():
    engine = _engine()
    _fails(engine, Service(id="S2", freelancer_user_id="f1", category_slug="graphic_design", title="x", status="live"))
    with Session(engine) as s:
        s.add(Service(id="S3", freelancer_user_id="f1", category_slug="graphic_design", title="Logo"))
        s.add(Contract(id="K2", organization_id="o1", freelancer_user_id="f1"))
        s.commit()
    _fails(engine, ServiceOrder(id="SO2", service_id="S3", contract_id="K2", organization_id="o1", freelancer_user_id="f1", package_key="gold", price_minor=100, delivery_days=3))
    _fails(engine, ServiceOrder(id="SO3", service_id="S3", contract_id="K2", organization_id="o1", freelancer_user_id="f1", package_key="basic", price_minor=100, delivery_days=0))
    with Session(engine) as s:
        s.add(Report(id="R1", reporter_user_id="c1", target_type="service", target_id="S3", reason="spam"))
        s.commit()


def test_migration_chain_and_head():
    text = MIGRATION.read_text()
    assert 'down_revision = "0074_profile_projects"' in text
    assert "UPDATE project_categories SET enabled = TRUE" in text
    # Later migrations move the head; the next one must exist.
    assert (BACKEND / "alembic" / "versions" / "0076_hourly_contracts.py").exists()

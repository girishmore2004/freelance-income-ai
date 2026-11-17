"""Schema tests for plans and AI credits (migration 0057)."""
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

from app.models import AICreditLedger, Base, Plan, User, UserPlan

MIGRATION = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0057_plans_credits.py"


def _engine():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(User(id="u1", email="u@x.test", password_hash="h"))
        session.add(Plan(code="free", name="Free", price_minor=0, ai_daily_limit=20, ai_monthly_limit=300, status="active"))
        session.flush()
        session.add(UserPlan(user_id="u1", plan_code="free"))
        session.add(AICreditLedger(id="c1", user_id="u1", delta=50, reason="grant", ref="g1"))
        session.commit()
    return engine


def _fails(engine, obj):
    with pytest.raises(IntegrityError):
        with Session(engine) as session:
            session.add(obj)
            session.commit()


def test_plan_values_are_constrained():
    engine = _engine()
    _fails(engine, Plan(code="neg", name="Neg", price_minor=-1, ai_daily_limit=1, ai_monthly_limit=1))
    _fails(engine, Plan(code="lim", name="Lim", ai_daily_limit=-1, ai_monthly_limit=1))
    _fails(engine, Plan(code="st", name="St", ai_daily_limit=1, ai_monthly_limit=1, status="live"))


def test_credit_movements_are_idempotent_and_non_zero():
    engine = _engine()
    _fails(engine, AICreditLedger(id="c2", user_id="u1", delta=10, reason="grant", ref="g1"))
    _fails(engine, AICreditLedger(id="c3", user_id="u1", delta=0, reason="grant", ref="g3"))
    _fails(engine, AICreditLedger(id="c4", user_id="u1", delta=1, reason="gift", ref="g4"))


def test_migration_seeds_only_the_free_plan_with_current_limits():
    source = MIGRATION.read_text()
    assert 'down_revision = "0056_ledger_foundation"' in source
    namespace: dict = {}
    exec(compile(source.split("def _tables", 1)[0], str(MIGRATION), "exec"), namespace)
    plan = namespace["FREE_PLAN"]
    assert (plan["code"], plan["ai_daily_limit"], plan["ai_monthly_limit"], plan["price_minor"]) == ("free", 20, 300, 0)
    assert source.count("INSERT INTO plans") == 1

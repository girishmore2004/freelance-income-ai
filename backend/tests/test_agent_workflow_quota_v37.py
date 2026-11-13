from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.database import Base
from app.models import User, AIUsageEvent
from app.services.usage_quota import enforce_quota, record_usage, usage_history


def make_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine, tables=[User.__table__, AIUsageEvent.__table__])
    return sessionmaker(bind=engine)()


def test_agent_workflow_usage_is_recorded_for_owning_account_only():
    db = make_db()
    a = User(email="agent-a37@example.test", password_hash="x")
    b = User(email="agent-b37@example.test", password_hash="x")
    db.add_all([a, b]); db.commit()
    allowed, _ = enforce_quota(db, a.id, "agent_workflow:business_review")
    assert allowed
    record_usage(db, a.id, "agent_workflow:business_review", "workflow", 0, 0)
    assert [x["operation"] for x in usage_history(db, a.id)] == ["agent_workflow:business_review"]
    assert usage_history(db, b.id) == []

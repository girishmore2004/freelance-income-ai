from datetime import datetime, timezone, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.database import Base
from app.models import User, AIUsageEvent, AbuseEvent
from app.services.usage_quota import record_usage, usage_report, cleanup_abuse_events


def make_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine, tables=[User.__table__, AIUsageEvent.__table__, AbuseEvent.__table__])
    return sessionmaker(bind=engine)()


def test_usage_report_is_account_scoped_and_groups_provider_operation():
    db = make_db()
    a = User(email="a36@example.test", password_hash="x")
    b = User(email="b36@example.test", password_hash="x")
    db.add_all([a, b]); db.commit()
    record_usage(db, a.id, "coach", "ollama", 10, 20)
    record_usage(db, a.id, "coach", "ollama", 5, 7)
    record_usage(db, b.id, "proposal", "openai", 100, 200)
    report = usage_report(db, a.id, 30)
    assert report["by_operation_provider"] == [{
        "operation": "coach", "provider": "ollama", "calls": 2,
        "input_chars": 15, "output_chars": 27
    }]
    assert sum(x["calls"] for x in report["daily_calls"]) == 2
    assert "cost_tracking" in report


def test_abuse_cleanup_is_dry_run_until_explicit_apply():
    db = make_db()
    user = User(email="cleanup36@example.test", password_hash="x")
    db.add(user); db.commit()
    old = AbuseEvent(user_id=user.id, event_type="rate_limit_exceeded", detail="category=api",
                     created_at=datetime.now(timezone.utc) - timedelta(days=120))
    db.add(old); db.commit()
    preview = cleanup_abuse_events(db, 90, apply=False)
    assert preview["eligible_events"] == 1
    assert preview["deleted_events"] == 0
    assert db.query(AbuseEvent).count() == 1
    applied = cleanup_abuse_events(db, 90, apply=True)
    assert applied["deleted_events"] == 1
    assert db.query(AbuseEvent).count() == 0

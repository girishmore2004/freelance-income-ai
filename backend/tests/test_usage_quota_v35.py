from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.database import Base
from app.models import User, AIUsageEvent, AbuseEvent
from app.services.usage_quota import usage_history, abuse_summary, record_usage

def make_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine, tables=[User.__table__, AIUsageEvent.__table__, AbuseEvent.__table__])
    return sessionmaker(bind=engine)()

def test_usage_history_is_account_scoped_and_bounded():
    db = make_db()
    a = User(email="a@example.test", password_hash="x")
    b = User(email="b@example.test", password_hash="x")
    db.add_all([a,b]); db.commit()
    record_usage(db, a.id, "coach", "ollama", 10, 20)
    record_usage(db, b.id, "proposal", "ollama", 30, 40)
    result = usage_history(db, a.id, 1000)
    assert len(result) == 1
    assert result[0]["operation"] == "coach"
    assert "cost" not in result[0]

def test_abuse_summary_is_account_scoped():
    db = make_db()
    a = User(email="a@example.test", password_hash="x")
    b = User(email="b@example.test", password_hash="x")
    db.add_all([a,b]); db.commit()
    db.add_all([AbuseEvent(user_id=a.id,event_type="rate_limit_exceeded",detail="category=ai"),
                AbuseEvent(user_id=b.id,event_type="ai_quota_exhausted",detail="private")])
    db.commit()
    summary = abuse_summary(db, a.id)
    assert summary["last_30_days"] == {"rate_limit_exceeded": 1}
    assert len(summary["events"]) == 1
    assert "private" not in str(summary)

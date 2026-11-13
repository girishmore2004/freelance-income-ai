from datetime import datetime, timezone
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.database import Base
from app.models import User, AIUsageEvent, AbuseEvent
from app.services.usage_quota import usage_totals, enforce_quota, record_usage


def make_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine, tables=[User.__table__, AIUsageEvent.__table__, AbuseEvent.__table__])
    return sessionmaker(bind=engine)()


def make_user(db, email):
    user = User(email=email, password_hash="test-hash")
    db.add(user); db.commit(); return user


def test_usage_isolated_by_account_and_records_operation():
    db = make_db()
    first = make_user(db, "one@example.test")
    second = make_user(db, "two@example.test")
    record_usage(db, first.id, "proposal_generation", "ollama", 100, 200)
    assert usage_totals(db, first.id)["daily_calls"] == 1
    assert usage_totals(db, second.id)["daily_calls"] == 0


def test_quota_exhaustion_creates_abuse_event(monkeypatch):
    db = make_db()
    user = make_user(db, "quota@example.test")
    monkeypatch.setattr("app.services.usage_quota.settings.ai_quota_daily_calls", 1)
    record_usage(db, user.id, "proposal_generation", "ollama")
    allowed, totals = enforce_quota(db, user.id, "proposal_generation")
    assert allowed is False
    assert totals["remaining_daily"] == 0
    assert db.query(AbuseEvent).filter_by(user_id=user.id, event_type="ai_quota_exhausted").count() == 1


def test_usage_record_does_not_claim_cost_or_tokens():
    db = make_db()
    user = make_user(db, "transparent@example.test")
    event = record_usage(db, user.id, "proposal_generation", "ollama", 42, 84)
    assert event.input_chars == 42
    assert event.output_chars == 84
    assert not hasattr(event, "cost_usd")
    assert not hasattr(event, "tokens")

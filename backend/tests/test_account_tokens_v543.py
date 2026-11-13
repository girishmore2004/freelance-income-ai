"""SQLite tests for single-use account action tokens without requiring pgvector."""
import importlib.util
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

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models import Base, User, EmailActionToken
from app.services.account_tokens import issue_action_token, consume_action_token


def _db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)()


def test_action_token_is_stored_as_digest_and_can_only_be_consumed_once():
    db = _db()
    user = User(email="token@example.test", password_hash="test")
    db.add(user); db.flush()
    raw = issue_action_token(db, user.id, "verify_email", 30)
    db.commit()
    row = db.query(EmailActionToken).one()
    assert row.token_hash != raw
    assert len(row.token_hash) == 64
    consumed = consume_action_token(db, raw, "verify_email")
    assert consumed is not None
    db.commit()
    assert consume_action_token(db, raw, "verify_email") is None
    db.close()


def test_issuing_a_new_token_invalidates_prior_unused_token():
    db = _db()
    user = User(email="token2@example.test", password_hash="test")
    db.add(user); db.flush()
    first = issue_action_token(db, user.id, "password_reset", 30)
    second = issue_action_token(db, user.id, "password_reset", 30)
    db.commit()
    assert consume_action_token(db, first, "password_reset") is None
    assert consume_action_token(db, second, "password_reset") is not None
    db.close()


def test_expired_action_token_cannot_be_consumed():
    from datetime import datetime, timedelta, timezone
    db = _db()
    user = User(email="expired-token@example.test", password_hash="test")
    db.add(user); db.flush()
    raw = issue_action_token(db, user.id, "verify_email", 30)
    row = db.query(EmailActionToken).one()
    row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()
    assert consume_action_token(db, raw, "verify_email") is None
    db.close()

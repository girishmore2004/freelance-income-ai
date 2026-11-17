"""Schema contract tests for the Edge API apply-agent tables (migration 0047).

The Edge API issues raw SQL against ``integrations``, ``applications`` and
``application_messages``. These tests pin the columns and uniqueness rules
that SQL depends on, using SQLite so they run without PostgreSQL.
"""
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
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Base, Opportunity, Proposal, User

MIGRATION = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0047_edge_apply_tables.py"

# Columns referenced by backend/edge-api/src/lib/apply-routes.ts and apply-agent.ts.
EDGE_COLUMNS = {
    "integrations": {"id", "user_id", "provider", "email", "refresh_token", "access_token", "expires_at", "created_at"},
    "applications": {"id", "user_id", "opportunity_id", "proposal_id", "channel", "status", "recipient",
                     "external_ref", "thread_id", "extra", "sent_at", "last_checked_at", "created_at"},
    "application_messages": {"id", "user_id", "application_id", "direction", "sender", "subject", "body",
                             "external_id", "message_ref", "received_at", "ai_label", "ai_summary",
                             "ai_suggestion", "created_at"},
}


def _engine():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return engine


def _seed(engine):
    with Session(engine) as session:
        for n in ("1", "2"):
            session.add(User(id=f"u{n}", email=f"user{n}@x.test", password_hash="h"))
            session.flush()
            session.add(Opportunity(id=f"o{n}", user_id=f"u{n}", title="T", description="D"))
            session.flush()
            session.add(Proposal(id=f"p{n}", user_id=f"u{n}", opportunity_id=f"o{n}", content="c"))
        session.commit()
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO applications (id, user_id, opportunity_id, proposal_id, channel, status) "
            "VALUES ('a1', 'u1', 'o1', 'p1', 'email', 'sent')"
        ))


@pytest.mark.parametrize("table", sorted(EDGE_COLUMNS))
def test_models_define_every_column_the_edge_api_uses(table):
    columns = {column["name"] for column in inspect(_engine()).get_columns(table)}
    assert EDGE_COLUMNS[table] <= columns


def test_integrations_has_one_row_per_user_and_provider():
    engine = _engine()
    _seed(engine)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO integrations (id, user_id, provider) VALUES ('i1', 'u1', 'gmail')"))
    with pytest.raises(IntegrityError):
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO integrations (id, user_id, provider) VALUES ('i2', 'u1', 'gmail')"))


def test_a_proposal_cannot_have_two_live_sends():
    engine = _engine()
    _seed(engine)
    with pytest.raises(IntegrityError):
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO applications (id, user_id, opportunity_id, proposal_id, channel, status) "
                "VALUES ('a2', 'u1', 'o1', 'p1', 'email', 'sending')"
            ))
    # A failed attempt is not live, so it does not block a later successful send.
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO applications (id, user_id, opportunity_id, proposal_id, channel, status) "
            "VALUES ('a3', 'u1', 'o1', 'p1', 'email', 'failed')"
        ))


def test_message_external_id_is_unique_per_user_not_globally():
    engine = _engine()
    _seed(engine)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO applications (id, user_id, opportunity_id, proposal_id, channel, status) VALUES ('b1', 'u2', 'o2', 'p2', 'email', 'sent')"))
        conn.execute(text("INSERT INTO application_messages (id, user_id, application_id, direction, external_id) VALUES ('m1', 'u1', 'a1', 'in', 'gmail:1')"))
        conn.execute(text("INSERT INTO application_messages (id, user_id, application_id, direction, external_id) VALUES ('m2', 'u2', 'b1', 'in', 'gmail:1')"))
    with pytest.raises(IntegrityError):
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO application_messages (id, user_id, application_id, direction, external_id) VALUES ('m3', 'u1', 'a1', 'in', 'gmail:1')"))


def test_migration_is_chained_after_0046_and_downgrade_keeps_tables():
    source = MIGRATION.read_text()
    assert 'down_revision = "0046_agent_workflow_rq_job_id"' in source
    assert 'revision = "0047_edge_apply_tables"' in source
    downgrade = source.split("def downgrade():", 1)[1]
    assert "drop_table" not in downgrade

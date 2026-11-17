"""Trust and admin: user reports and an append-only moderation log (Phase 7).

Revision ID: 0060_trust_admin
Revises: 0059_assistants_live

* ``reports``: a user's report about a listing, user, proposal, contract
  message or review, with a reason, status (open → actioned / dismissed) and
  the staff resolution. One open report per reporter and target.
* ``moderation_actions``: append-only log of every staff decision (listing
  approved/returned/hidden, report actioned/dismissed, flag changed). In
  PostgreSQL UPDATE/DELETE on it are refused, like the ledger.

Additive. Downgrade drops the two tables and the guard.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0060_trust_admin"
down_revision = "0059_assistants_live"
branch_labels = None
depends_on = None

TARGETS = "('listing', 'user', 'proposal', 'contract_message', 'review')"
REASONS = "('spam', 'scam', 'off_platform', 'abuse', 'prohibited', 'fake', 'other')"

POSTGRES_GUARD = """
CREATE OR REPLACE FUNCTION moderation_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'moderation_actions is append-only' USING ERRCODE = '42501';
END
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS moderation_actions_append_only ON moderation_actions;
CREATE TRIGGER moderation_actions_append_only BEFORE UPDATE OR DELETE ON moderation_actions
  FOR EACH ROW EXECUTE FUNCTION moderation_append_only();
"""


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def upgrade():
    tables = _tables()
    if "agent_definitions" not in tables:
        raise RuntimeError("agent_definitions does not exist. Apply 0058 first.")
    now = sa.text("CURRENT_TIMESTAMP")
    if "reports" not in tables:
        op.create_table(
            "reports",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("reporter_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("target_type", sa.String(30), nullable=False),
            sa.Column("target_id", sa.String(64), nullable=False),
            sa.Column("reason", sa.String(30), nullable=False),
            sa.Column("details", sa.Text(), nullable=False, server_default=""),
            sa.Column("status", sa.String(20), nullable=False, server_default="open"),
            sa.Column("resolution_note", sa.Text(), nullable=False, server_default=""),
            sa.Column("resolved_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.CheckConstraint(f"target_type IN {TARGETS}", name="ck_reports_target"),
            sa.CheckConstraint(f"reason IN {REASONS}", name="ck_reports_reason"),
            sa.CheckConstraint("status IN ('open', 'actioned', 'dismissed')", name="ck_reports_status"),
        )
        op.create_index("ix_reports_status_created", "reports", ["status", "created_at"])
        op.create_index(
            "uq_reports_open_per_reporter", "reports", ["reporter_user_id", "target_type", "target_id"], unique=True,
            postgresql_where=sa.text("status = 'open'"), sqlite_where=sa.text("status = 'open'"),
        )
    if "moderation_actions" not in tables:
        op.create_table(
            "moderation_actions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("actor_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("target_type", sa.String(30), nullable=False),
            sa.Column("target_id", sa.String(80), nullable=False),
            sa.Column("action", sa.String(40), nullable=False),
            sa.Column("note", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        )
        op.create_index("ix_moderation_actions_target", "moderation_actions", ["target_type", "target_id", "created_at"])
    if op.get_bind().dialect.name == "postgresql":
        op.execute(POSTGRES_GUARD)


def downgrade():
    tables = _tables()
    if op.get_bind().dialect.name == "postgresql" and "moderation_actions" in tables:
        op.execute("DROP TRIGGER IF EXISTS moderation_actions_append_only ON moderation_actions")
        op.execute("DROP FUNCTION IF EXISTS moderation_append_only()")
    for name in ("moderation_actions", "reports"):
        if name in tables:
            op.drop_table(name)

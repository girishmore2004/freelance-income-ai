"""Disputes, account suspension and appeals (Phase 7).

Revision ID: 0063_disputes_suspensions
Revises: 0062_notifications_inbox

* ``disputes``: a party's dispute on a contract (one open per contract), with
  the staff resolution (release funded milestones, refund them, or no action).
* ``dispute_statements``: each party's account and evidence notes.
* ``users.suspended_at`` and ``account_suspensions``: staff suspension with
  reason, lift, and one appeal per suspension (upheld or overturned by staff).
  The Edge API reads ``suspended_at`` through ``to_jsonb(users)`` so sign-in
  keeps working before this migration runs.

Additive. Downgrade drops the three tables and the column.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0063_disputes_suspensions"
down_revision = "0062_notifications_inbox"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def upgrade():
    tables = _tables()
    now = sa.text("CURRENT_TIMESTAMP")
    if "suspended_at" not in {c["name"] for c in inspect(op.get_bind()).get_columns("users")}:
        op.add_column("users", sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True))

    if "disputes" not in tables:
        op.create_table(
            "disputes",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("contract_id", sa.String(36), sa.ForeignKey("contracts.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("opened_by_party", sa.String(20), nullable=False),
            sa.Column("opened_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("reason", sa.String(30), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("desired_outcome", sa.Text(), nullable=False, server_default=""),
            sa.Column("status", sa.String(20), nullable=False, server_default="open"),
            sa.Column("resolution", sa.String(30), nullable=True),
            sa.Column("resolution_note", sa.Text(), nullable=False, server_default=""),
            sa.Column("resolved_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.CheckConstraint("opened_by_party IN ('client', 'freelancer')", name="ck_disputes_party"),
            sa.CheckConstraint("reason IN ('quality', 'non_delivery', 'scope', 'payment', 'communication', 'other')", name="ck_disputes_reason"),
            sa.CheckConstraint("status IN ('open', 'resolved', 'withdrawn')", name="ck_disputes_status"),
            sa.CheckConstraint("resolution IS NULL OR resolution IN ('release_funded', 'refund_funded', 'no_action')", name="ck_disputes_resolution"),
        )
        op.create_index("ix_disputes_status_created", "disputes", ["status", "created_at"])
        op.create_index(
            "uq_disputes_open_per_contract", "disputes", ["contract_id"], unique=True,
            postgresql_where=sa.text("status = 'open'"), sqlite_where=sa.text("status = 'open'"),
        )

    if "dispute_statements" not in tables:
        op.create_table(
            "dispute_statements",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("dispute_id", sa.String(36), sa.ForeignKey("disputes.id", ondelete="CASCADE"), nullable=False),
            sa.Column("party", sa.String(20), nullable=False),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.CheckConstraint("party IN ('client', 'freelancer')", name="ck_dispute_statements_party"),
        )
        op.create_index("ix_dispute_statements_dispute", "dispute_statements", ["dispute_id", "created_at"])

    if "account_suspensions" not in tables:
        op.create_table(
            "account_suspensions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="active"),
            sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.Column("lifted_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("lifted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("lift_note", sa.Text(), nullable=False, server_default=""),
            sa.Column("appeal_text", sa.Text(), nullable=False, server_default=""),
            sa.Column("appeal_status", sa.String(20), nullable=False, server_default="none"),
            sa.Column("appeal_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint("status IN ('active', 'lifted')", name="ck_account_suspensions_status"),
            sa.CheckConstraint("appeal_status IN ('none', 'pending', 'upheld', 'overturned')", name="ck_account_suspensions_appeal"),
        )
        op.create_index(
            "uq_account_suspensions_active", "account_suspensions", ["user_id"], unique=True,
            postgresql_where=sa.text("status = 'active'"), sqlite_where=sa.text("status = 'active'"),
        )


def downgrade():
    tables = _tables()
    for name in ("account_suspensions", "dispute_statements", "disputes"):
        if name in tables:
            op.drop_table(name)
    if "suspended_at" in {c["name"] for c in inspect(op.get_bind()).get_columns("users")}:
        op.drop_column("users", "suspended_at")

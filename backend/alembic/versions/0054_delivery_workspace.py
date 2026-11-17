"""Shared delivery workspace for contracts (Phase 3).

Revision ID: 0054_delivery_workspace
Revises: 0053_proposals_contracts

* ``contracts.completed_at``: set when every milestone is approved.
* ``contract_messages``: messages between the parties of a contract.
* ``milestone_submissions``: the freelancer's delivery for one milestone
  (note + links) and the client's review (approved / revision requested).
  The milestone's state is its latest submission.
* ``contract_events``: append-only activity log (who did what, when).

Approval records acceptance of work only; no money moves (payments are
disabled until D-1/D-2 are approved).

All additive. Downgrade drops the three tables and the column.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0054_delivery_workspace"
down_revision = "0053_proposals_contracts"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def upgrade():
    tables = _tables()
    if "contracts" not in tables:
        raise RuntimeError("contracts does not exist. Apply 0053 first.")
    now = sa.text("CURRENT_TIMESTAMP")

    if "completed_at" not in {c["name"] for c in inspect(op.get_bind()).get_columns("contracts")}:
        op.add_column("contracts", sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True))

    if "contract_messages" not in tables:
        op.create_table(
            "contract_messages",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("contract_id", sa.String(36), sa.ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sender_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("sender_party", sa.String(20), nullable=False),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.CheckConstraint("sender_party IN ('client', 'freelancer')", name="ck_contract_messages_party"),
        )
        op.create_index("ix_contract_messages_contract", "contract_messages", ["contract_id", "created_at"])

    if "milestone_submissions" not in tables:
        op.create_table(
            "milestone_submissions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("contract_id", sa.String(36), sa.ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False),
            sa.Column("milestone_index", sa.Integer(), nullable=False),
            sa.Column("contract_version", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(30), nullable=False, server_default="submitted"),
            sa.Column("note", sa.Text(), nullable=False, server_default=""),
            sa.Column("links_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("submitted_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.Column("reviewed_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("review_note", sa.Text(), nullable=False, server_default=""),
            sa.CheckConstraint("status IN ('submitted', 'approved', 'revision_requested')", name="ck_milestone_submissions_status"),
            sa.CheckConstraint("milestone_index >= 0 AND milestone_index < 20", name="ck_milestone_submissions_index"),
        )
        op.create_index("ix_milestone_submissions_contract", "milestone_submissions", ["contract_id", "milestone_index", "submitted_at"])
        # At most one submission awaiting review per milestone.
        op.create_index(
            "uq_milestone_open_submission", "milestone_submissions", ["contract_id", "milestone_index"], unique=True,
            postgresql_where=sa.text("status = 'submitted'"), sqlite_where=sa.text("status = 'submitted'"),
        )

    if "contract_events" not in tables:
        op.create_table(
            "contract_events",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("contract_id", sa.String(36), sa.ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False),
            sa.Column("actor_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("actor_party", sa.String(20), nullable=False),
            sa.Column("event_type", sa.String(60), nullable=False),
            sa.Column("details_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.CheckConstraint("actor_party IN ('client', 'freelancer', 'system')", name="ck_contract_events_party"),
        )
        op.create_index("ix_contract_events_contract", "contract_events", ["contract_id", "created_at"])


def downgrade():
    tables = _tables()
    for name in ("contract_events", "milestone_submissions", "contract_messages"):
        if name in tables:
            op.drop_table(name)
    if "contracts" in tables and "completed_at" in {c["name"] for c in inspect(op.get_bind()).get_columns("contracts")}:
        op.drop_column("contracts", "completed_at")

"""Pre-contract discussions and interviews on native proposals (U9).

Revision ID: 0070_discussions_interviews
Revises: 0069_external_pipeline

``proposal_messages``: the conversation between a client organisation and a
freelancer about one proposal, before any offer (clarifying questions,
revised proposal requests in context). Screened like contract messages.

``proposal_interviews``: interview slots proposed by either side on a
proposal. The other side accepts or declines; either side can cancel; after
the time, the client records it as completed. A meeting link must be https on
a known meeting service (no contact details).

Additive only. Downgrade drops both tables.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0070_discussions_interviews"
down_revision = "0069_external_pipeline"
branch_labels = None
depends_on = None


def upgrade():
    tables = set(inspect(op.get_bind()).get_table_names())
    if "proposal_messages" not in tables:
        op.create_table(
            "proposal_messages",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("proposal_id", sa.String(36), sa.ForeignKey("listing_proposals.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sender_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("sender_party", sa.String(20), nullable=False),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.CheckConstraint("sender_party IN ('client', 'freelancer')", name="ck_proposal_messages_party"),
        )
        op.create_index("ix_proposal_messages_proposal", "proposal_messages", ["proposal_id", "created_at"])
    if "proposal_interviews" not in tables:
        op.create_table(
            "proposal_interviews",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("proposal_id", sa.String(36), sa.ForeignKey("listing_proposals.id", ondelete="CASCADE"), nullable=False),
            sa.Column("proposed_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("proposed_party", sa.String(20), nullable=False),
            sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("duration_minutes", sa.Integer(), nullable=False, server_default="30"),
            sa.Column("mode", sa.String(20), nullable=False, server_default="video"),
            sa.Column("meeting_link", sa.String(500), nullable=False, server_default=""),
            sa.Column("agenda", sa.Text(), nullable=False, server_default=""),
            sa.Column("status", sa.String(20), nullable=False, server_default="proposed"),
            sa.Column("responded_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("outcome_note", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.CheckConstraint("proposed_party IN ('client', 'freelancer')", name="ck_proposal_interviews_party"),
            sa.CheckConstraint("mode IN ('video', 'phone', 'chat')", name="ck_proposal_interviews_mode"),
            sa.CheckConstraint("status IN ('proposed', 'accepted', 'declined', 'cancelled', 'completed')", name="ck_proposal_interviews_status"),
            sa.CheckConstraint("duration_minutes BETWEEN 15 AND 180", name="ck_proposal_interviews_duration"),
        )
        op.create_index("ix_proposal_interviews_proposal", "proposal_interviews", ["proposal_id", "starts_at"])


def downgrade():
    tables = set(inspect(op.get_bind()).get_table_names())
    if "proposal_interviews" in tables:
        op.drop_table("proposal_interviews")
    if "proposal_messages" in tables:
        op.drop_table("proposal_messages")

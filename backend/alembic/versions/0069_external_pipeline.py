"""External application lifecycle: proposal versions and an opportunity event history (U8).

Revision ID: 0069_external_pipeline
Revises: 0068_saved_listings_support

Each external opportunity becomes one project-centric record:

``proposal_versions``: every text the freelancer or the AI produced for an
external proposal (model draft, safe template, each edit). Approvals stay
hash-bound to the current text; versions keep the history. Existing proposals
are backfilled as their current version with source ``legacy``.

``opportunity_events``: the opportunity's history — status changes (with the
previous and new status), submissions (linked to the ``applications`` row),
follow-ups and interviews (with a due date and a done time) and notes.

Additive only. Downgrade drops both tables.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0069_external_pipeline"
down_revision = "0068_saved_listings_support"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    if "proposal_versions" not in tables:
        op.create_table(
            "proposal_versions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("proposal_id", sa.String(36), sa.ForeignKey("proposals.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("proposed_price", sa.Float(), nullable=True),
            sa.Column("currency", sa.String(8), nullable=False, server_default="INR"),
            sa.Column("source", sa.String(20), nullable=False, server_default="edited"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.CheckConstraint("source IN ('model', 'safe_template', 'edited', 'legacy')", name="ck_proposal_versions_source"),
            sa.CheckConstraint("version >= 1", name="ck_proposal_versions_version"),
            sa.UniqueConstraint("proposal_id", "version", name="uq_proposal_version"),
        )
        bind.execute(
            sa.text(
                "INSERT INTO proposal_versions (id, proposal_id, user_id, version, content, proposed_price, currency, source, created_at) "
                "SELECT p.id, p.id, p.user_id, COALESCE(p.version, 1), p.content, p.proposed_price, COALESCE(p.currency, 'INR'), 'legacy', p.created_at "
                "FROM proposals p"
            )
        )
    if "opportunity_events" not in tables:
        op.create_table(
            "opportunity_events",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("opportunity_id", sa.String(36), sa.ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("kind", sa.String(20), nullable=False),
            sa.Column("from_status", sa.String(40), nullable=True),
            sa.Column("to_status", sa.String(40), nullable=True),
            sa.Column("note", sa.Text(), nullable=False, server_default=""),
            sa.Column("due_date", sa.Date(), nullable=True),
            sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("application_id", sa.String(36), sa.ForeignKey("applications.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.CheckConstraint("kind IN ('status', 'submission', 'follow_up', 'interview', 'note')", name="ck_opportunity_events_kind"),
        )
        op.create_index("ix_opportunity_events_opportunity", "opportunity_events", ["opportunity_id", "created_at"])
        op.create_index("ix_opportunity_events_due", "opportunity_events", ["user_id", "due_date"])


def downgrade():
    tables = set(inspect(op.get_bind()).get_table_names())
    if "opportunity_events" in tables:
        op.drop_table("opportunity_events")
    if "proposal_versions" in tables:
        op.drop_table("proposal_versions")

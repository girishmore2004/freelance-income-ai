"""Proposal Studio: structured proposal sections, version history and revision requests (U5).

Revision ID: 0067_proposal_studio
Revises: 0066_business_coach_partial

``listing_proposals`` gains:
- ``sections_json``: the structured proposal (understanding, approach,
  evidence from the freelancer's own portfolio links, deliverables,
  milestones, assumptions, exclusions, questions, revision rounds). NULL for
  proposals sent with the older single-text form.
- ``current_version``: the version number of the text the client sees.
- ``content_hash``: SHA-256 of the exact submitted content (hash-bound approval, F4).
- ``revision_requested_at`` / ``revision_note``: the client's last request for a
  revised proposal. Cleared when the freelancer saves a new version.

``listing_proposal_versions``: one immutable row per submitted or edited
version, so both sides can see what changed and when. Existing proposals are
backfilled as version 1 from their current text.

Additive only. Downgrade drops the version table and the new columns.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0067_proposal_studio"
down_revision = "0066_business_coach_partial"
branch_labels = None
depends_on = None


def _columns(bind, table):
    return {c["name"] for c in inspect(bind).get_columns(table)}


def upgrade():
    bind = op.get_bind()
    existing = _columns(bind, "listing_proposals")
    if "sections_json" not in existing:
        op.add_column("listing_proposals", sa.Column("sections_json", sa.JSON(), nullable=True))
    if "current_version" not in existing:
        op.add_column("listing_proposals", sa.Column("current_version", sa.Integer(), nullable=False, server_default="1"))
    if "content_hash" not in existing:
        op.add_column("listing_proposals", sa.Column("content_hash", sa.String(64), nullable=True))
    if "revision_requested_at" not in existing:
        op.add_column("listing_proposals", sa.Column("revision_requested_at", sa.DateTime(timezone=True), nullable=True))
    if "revision_note" not in existing:
        op.add_column("listing_proposals", sa.Column("revision_note", sa.Text(), nullable=True))

    if "listing_proposal_versions" not in set(inspect(bind).get_table_names()):
        op.create_table(
            "listing_proposal_versions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("proposal_id", sa.String(36), sa.ForeignKey("listing_proposals.id", ondelete="CASCADE"), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("cover_letter", sa.Text(), nullable=False, server_default=""),
            sa.Column("price_minor", sa.BigInteger(), nullable=False),
            sa.Column("estimated_days", sa.Integer(), nullable=True),
            sa.Column("sections_json", sa.JSON(), nullable=True),
            sa.Column("content_hash", sa.String(64), nullable=True),
            sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.CheckConstraint("version >= 1", name="ck_listing_proposal_versions_version"),
            sa.CheckConstraint("price_minor > 0", name="ck_listing_proposal_versions_price"),
            sa.UniqueConstraint("proposal_id", "version", name="uq_listing_proposal_version"),
        )
        # Backfill: every existing proposal's current text becomes version 1.
        bind.execute(
            sa.text(
                "INSERT INTO listing_proposal_versions (id, proposal_id, version, cover_letter, price_minor, estimated_days, created_by, created_at) "
                "SELECT p.id, p.id, 1, p.cover_letter, p.price_minor, p.estimated_days, p.freelancer_user_id, p.created_at "
                "FROM listing_proposals p"
            )
        )


def downgrade():
    bind = op.get_bind()
    if "listing_proposal_versions" in set(inspect(bind).get_table_names()):
        op.drop_table("listing_proposal_versions")
    existing = _columns(bind, "listing_proposals")
    for name in ("revision_note", "revision_requested_at", "content_hash", "current_version", "sections_json"):
        if name in existing:
            op.drop_column("listing_proposals", name)

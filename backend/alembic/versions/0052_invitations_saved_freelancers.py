"""Matching support: freelancer opt-in, listing invitations, saved freelancers (Phase 2).

Revision ID: 0052_invitations_saved_freelancers
Revises: 0051_native_project_listings

* ``profiles.marketplace_visible`` / ``marketplace_visible_at``: a freelancer
  must opt in before the Match and Shortlist agent (C2) shows them to clients.
  Default is off, so no existing profile becomes visible by this migration.
* ``listing_invitations``: one invitation per listing and freelancer
  (pending → accepted / declined, or withdrawn by the client).
* ``saved_freelancers``: an organisation's saved freelancers (one row each).

All additive. Downgrade drops the two tables and the two columns.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0052_invitations_saved_freelancers"
down_revision = "0051_native_project_listings"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set[str]:
    return {c["name"] for c in inspect(op.get_bind()).get_columns(table)}


def upgrade():
    tables = _tables()
    if "project_listings" not in tables:
        raise RuntimeError("project_listings does not exist. Apply 0051 first.")
    now = sa.text("CURRENT_TIMESTAMP")

    profile_columns = _columns("profiles")
    if "marketplace_visible" not in profile_columns:
        op.add_column("profiles", sa.Column("marketplace_visible", sa.Boolean(), nullable=False, server_default=sa.false()))
    if "marketplace_visible_at" not in profile_columns:
        op.add_column("profiles", sa.Column("marketplace_visible_at", sa.DateTime(timezone=True), nullable=True))

    if "listing_invitations" not in tables:
        op.create_table(
            "listing_invitations",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("listing_id", sa.String(36), sa.ForeignKey("project_listings.id", ondelete="CASCADE"), nullable=False),
            sa.Column("freelancer_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("invited_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("message", sa.Text(), nullable=False, server_default=""),
            sa.Column("match_score", sa.Integer(), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint("listing_id", "freelancer_user_id", name="uq_listing_invitation"),
            sa.CheckConstraint("status IN ('pending', 'accepted', 'declined', 'withdrawn')", name="ck_listing_invitations_status"),
        )
        op.create_index("ix_listing_invitations_freelancer", "listing_invitations", ["freelancer_user_id", "created_at"])

    if "saved_freelancers" not in tables:
        op.create_table(
            "saved_freelancers",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("freelancer_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("saved_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("note", sa.String(300), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.UniqueConstraint("organization_id", "freelancer_user_id", name="uq_saved_freelancer"),
        )


def downgrade():
    tables = _tables()
    for name in ("saved_freelancers", "listing_invitations"):
        if name in tables:
            op.drop_table(name)
    profile_columns = _columns("profiles")
    for column in ("marketplace_visible_at", "marketplace_visible"):
        if column in profile_columns:
            op.drop_column("profiles", column)

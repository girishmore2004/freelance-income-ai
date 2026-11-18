"""Saved projects for freelancers and support tickets (U7).

Revision ID: 0068_saved_listings_support
Revises: 0067_proposal_studio

``saved_listings``: a freelancer's saved native projects (one row per user and
listing, optional private note). Deleting the user or the listing removes it.

``support_tickets``: messages from the public Contact page or signed-in users,
handled by staff on /admin. Visitors leave an email; signed-in users are linked
by ``user_id``. Staff resolve a ticket with a note (shown to a signed-in user
in their notifications).

Additive only. Downgrade drops both tables.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0068_saved_listings_support"
down_revision = "0067_proposal_studio"
branch_labels = None
depends_on = None


def upgrade():
    tables = set(inspect(op.get_bind()).get_table_names())
    if "saved_listings" not in tables:
        op.create_table(
            "saved_listings",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("listing_id", sa.String(36), sa.ForeignKey("project_listings.id", ondelete="CASCADE"), nullable=False),
            sa.Column("note", sa.String(300), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.UniqueConstraint("user_id", "listing_id", name="uq_saved_listing"),
        )
        op.create_index("ix_saved_listings_user", "saved_listings", ["user_id", "created_at"])
    if "support_tickets" not in tables:
        op.create_table(
            "support_tickets",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("email", sa.String(255), nullable=False, server_default=""),
            sa.Column("name", sa.String(120), nullable=False, server_default=""),
            sa.Column("topic", sa.String(30), nullable=False),
            sa.Column("subject", sa.String(160), nullable=False),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="open"),
            sa.Column("resolution_note", sa.Text(), nullable=False, server_default=""),
            sa.Column("resolved_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.CheckConstraint("topic IN ('account', 'payments', 'project', 'safety', 'business', 'other')", name="ck_support_tickets_topic"),
            sa.CheckConstraint("status IN ('open', 'resolved')", name="ck_support_tickets_status"),
        )
        op.create_index("ix_support_tickets_status", "support_tickets", ["status", "created_at"])
        op.create_index("ix_support_tickets_user", "support_tickets", ["user_id", "created_at"])


def downgrade():
    tables = set(inspect(op.get_bind()).get_table_names())
    if "support_tickets" in tables:
        op.drop_table("support_tickets")
    if "saved_listings" in tables:
        op.drop_table("saved_listings")

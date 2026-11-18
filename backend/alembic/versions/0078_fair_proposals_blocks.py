"""Fair proposals and blocking (U23, Master Plan B12 and Step 6).

Revision ID: 0078_fair_proposals_blocks
Revises: 0077_agent_registry_refresh

- ``project_listings.max_proposals``: optional client cap (1–500) on the
  proposals a project accepts; when it is reached the project closes to new
  proposals by itself.
- ``project_listings.proposals_closed_at``: set when the client closes the
  project to new proposals (or the cap is reached); NULL = accepting.
- ``marketplace_blocks``: a block between a freelancer and a client account
  (organisation), made by either side. While it exists there are no
  proposals, invitations, service orders or proposal messages between them.
  One row per side, so either side's block can be lifted only by that side.

The weekly proposal limit needs no table: it is computed from
``listing_proposals`` (index ``ix_listing_proposals_freelancer``).

Additive. Downgrade drops the table and the two columns.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0078_fair_proposals_blocks"
down_revision = "0077_agent_registry_refresh"
branch_labels = None
depends_on = None

NOW = sa.text("CURRENT_TIMESTAMP")


def upgrade():
    bind = op.get_bind()
    insp = inspect(bind)
    tables = set(insp.get_table_names())

    if "project_listings" in tables:
        cols = {c["name"] for c in insp.get_columns("project_listings")}
        if "max_proposals" not in cols:
            op.add_column("project_listings", sa.Column("max_proposals", sa.Integer(), nullable=True))
            op.create_check_constraint(
                "ck_project_listings_max_proposals",
                "project_listings",
                "max_proposals IS NULL OR max_proposals BETWEEN 1 AND 500",
            )
        if "proposals_closed_at" not in cols:
            op.add_column("project_listings", sa.Column("proposals_closed_at", sa.DateTime(timezone=True), nullable=True))

    if "marketplace_blocks" not in tables:
        op.create_table(
            "marketplace_blocks",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("freelancer_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("blocked_by", sa.String(16), nullable=False),
            sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("reason", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
            sa.CheckConstraint("blocked_by IN ('freelancer', 'client')", name="ck_marketplace_blocks_side"),
            sa.UniqueConstraint("freelancer_user_id", "organization_id", "blocked_by", name="uq_marketplace_blocks_pair"),
        )
        op.create_index("ix_marketplace_blocks_org", "marketplace_blocks", ["organization_id"])


def downgrade():
    bind = op.get_bind()
    insp = inspect(bind)
    tables = set(insp.get_table_names())
    if "marketplace_blocks" in tables:
        op.drop_index("ix_marketplace_blocks_org", table_name="marketplace_blocks")
        op.drop_table("marketplace_blocks")
    if "project_listings" in tables:
        cols = {c["name"] for c in insp.get_columns("project_listings")}
        if "proposals_closed_at" in cols:
            op.drop_column("project_listings", "proposals_closed_at")
        if "max_proposals" in cols:
            op.drop_constraint("ck_project_listings_max_proposals", "project_listings", type_="check")
            op.drop_column("project_listings", "max_proposals")

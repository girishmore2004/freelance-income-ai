"""Marketplace connection and application tracking.

Revision ID: 0014_marketplace_foundation
Revises: 0013_communication_intelligence
"""
from alembic import op
import sqlalchemy as sa

revision = "0014_marketplace_foundation"
down_revision = "0013_communication_intelligence"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        "marketplace_connections",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="not_configured"),
        sa.Column("access_mode", sa.String(30), nullable=False, server_default="manual"),
        sa.Column("external_account_id", sa.String(255), nullable=False, server_default=""),
        sa.Column("scopes", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("last_checked_at", sa.DateTime(timezone=True)),
        sa.Column("last_error", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "provider", name="uq_user_marketplace_provider"),
    )
    op.create_index("ix_marketplace_connections_user_id", "marketplace_connections", ["user_id"])
    op.create_table(
        "marketplace_applications",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("opportunity_id", sa.String(36), sa.ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("proposal_id", sa.String(36), sa.ForeignKey("proposals.id", ondelete="SET NULL")),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column("external_opportunity_id", sa.String(255), nullable=False, server_default=""),
        sa.Column("external_application_id", sa.String(255), nullable=False, server_default=""),
        sa.Column("status", sa.String(30), nullable=False, server_default="draft"),
        sa.Column("approval_hash", sa.String(64), nullable=False, server_default=""),
        sa.Column("approved_at", sa.DateTime(timezone=True)),
        sa.Column("submitted_at", sa.DateTime(timezone=True)),
        sa.Column("outcome_note", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "provider", "external_opportunity_id", name="uq_user_provider_external_application"),
    )
    op.create_index("ix_marketplace_applications_user_id", "marketplace_applications", ["user_id"])
    op.create_index("ix_marketplace_applications_opportunity_id", "marketplace_applications", ["opportunity_id"])
    op.create_table(
        "marketplace_audit_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("application_id", sa.String(36), sa.ForeignKey("marketplace_applications.id", ondelete="SET NULL")),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column("event_type", sa.String(60), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False, server_default=""),
        sa.Column("actor", sa.String(20), nullable=False, server_default="system"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_marketplace_audit_events_user_id", "marketplace_audit_events", ["user_id"])
    op.create_index("ix_marketplace_audit_events_application_id", "marketplace_audit_events", ["application_id"])

def downgrade():
    op.drop_index("ix_marketplace_audit_events_application_id", table_name="marketplace_audit_events")
    op.drop_index("ix_marketplace_audit_events_user_id", table_name="marketplace_audit_events")
    op.drop_table("marketplace_audit_events")
    op.drop_index("ix_marketplace_applications_opportunity_id", table_name="marketplace_applications")
    op.drop_index("ix_marketplace_applications_user_id", table_name="marketplace_applications")
    op.drop_table("marketplace_applications")
    op.drop_index("ix_marketplace_connections_user_id", table_name="marketplace_connections")
    op.drop_table("marketplace_connections")

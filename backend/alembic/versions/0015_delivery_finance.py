"""Delivery workspace and invoice schedule automation foundation.

Revision ID: 0015_delivery_finance
Revises: 0014_marketplace_foundation
"""
from alembic import op
import sqlalchemy as sa

revision = "0015_delivery_finance"
down_revision = "0014_marketplace_foundation"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "project_deliverables",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_id", sa.String(36), sa.ForeignKey("project_tasks.id", ondelete="SET NULL")),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("content_reference", sa.Text(), nullable=False, server_default=""),
        sa.Column("due_date", sa.String(80), nullable=False, server_default=""),
        sa.Column("status", sa.String(30), nullable=False, server_default="draft"),
        sa.Column("review_hash", sa.String(64), nullable=False, server_default=""),
        sa.Column("review_note", sa.Text(), nullable=False, server_default=""),
        sa.Column("submitted_for_review_at", sa.DateTime(timezone=True)),
        sa.Column("approved_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_project_deliverables_user_id", "project_deliverables", ["user_id"])
    op.create_index("ix_project_deliverables_project_id", "project_deliverables", ["project_id"])
    op.create_table(
        "deliverable_revisions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("deliverable_id", sa.String(36), sa.ForeignKey("project_deliverables.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("content_reference", sa.Text(), nullable=False, server_default=""),
        sa.Column("change_note", sa.Text(), nullable=False, server_default=""),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_deliverable_revisions_user_id", "deliverable_revisions", ["user_id"])
    op.create_index("ix_deliverable_revisions_deliverable_id", "deliverable_revisions", ["deliverable_id"])
    op.create_table(
        "invoice_schedules",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("milestone_id", sa.String(36), sa.ForeignKey("milestones.id", ondelete="SET NULL")),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("currency", sa.String(8), nullable=False, server_default="INR"),
        sa.Column("due_date", sa.String(10), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="planned"),
        sa.Column("approval_hash", sa.String(64), nullable=False, server_default=""),
        sa.Column("approved_at", sa.DateTime(timezone=True)),
        sa.Column("invoice_id", sa.String(36), sa.ForeignKey("invoices.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_invoice_schedules_user_id", "invoice_schedules", ["user_id"])
    op.create_index("ix_invoice_schedules_project_id", "invoice_schedules", ["project_id"])
    op.create_table(
        "delivery_audit_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("deliverable_id", sa.String(36), sa.ForeignKey("project_deliverables.id", ondelete="SET NULL")),
        sa.Column("event_type", sa.String(60), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_delivery_audit_events_user_id", "delivery_audit_events", ["user_id"])
    op.create_index("ix_delivery_audit_events_project_id", "delivery_audit_events", ["project_id"])


def downgrade():
    op.drop_index("ix_delivery_audit_events_project_id", table_name="delivery_audit_events")
    op.drop_index("ix_delivery_audit_events_user_id", table_name="delivery_audit_events")
    op.drop_table("delivery_audit_events")
    op.drop_index("ix_invoice_schedules_project_id", table_name="invoice_schedules")
    op.drop_index("ix_invoice_schedules_user_id", table_name="invoice_schedules")
    op.drop_table("invoice_schedules")
    op.drop_index("ix_deliverable_revisions_deliverable_id", table_name="deliverable_revisions")
    op.drop_index("ix_deliverable_revisions_user_id", table_name="deliverable_revisions")
    op.drop_table("deliverable_revisions")
    op.drop_index("ix_project_deliverables_project_id", table_name="project_deliverables")
    op.drop_index("ix_project_deliverables_user_id", table_name="project_deliverables")
    op.drop_table("project_deliverables")

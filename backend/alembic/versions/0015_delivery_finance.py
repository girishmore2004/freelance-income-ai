"""Delivery workspace and invoice schedule automation foundation.

Revision ID: 0015_delivery_finance
Revises: 0014_marketplace_foundation

The initial metadata baseline may already create these tables on a fresh
database. This revision creates only missing tables and indexes.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0015_delivery_finance"
down_revision = "0014_marketplace_foundation"
branch_labels = None
depends_on = None


def _create_table_if_missing(name, *columns):
    bind = op.get_bind()
    if name not in inspect(bind).get_table_names():
        op.create_table(name, *columns)


def _create_index_if_missing(name, table_name, columns):
    bind = op.get_bind()
    inspector = inspect(bind)

    if table_name not in inspector.get_table_names():
        return

    existing = {
        index["name"]
        for index in inspector.get_indexes(table_name)
    }

    if name not in existing:
        op.create_index(name, table_name, columns)


def upgrade():
    _create_table_if_missing(
        "project_deliverables",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "task_id",
            sa.String(36),
            sa.ForeignKey("project_tasks.id", ondelete="SET NULL"),
        ),
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

    _create_index_if_missing(
        "ix_project_deliverables_user_id",
        "project_deliverables",
        ["user_id"],
    )
    _create_index_if_missing(
        "ix_project_deliverables_project_id",
        "project_deliverables",
        ["project_id"],
    )

    _create_table_if_missing(
        "deliverable_revisions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "deliverable_id",
            sa.String(36),
            sa.ForeignKey("project_deliverables.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("content_reference", sa.Text(), nullable=False, server_default=""),
        sa.Column("change_note", sa.Text(), nullable=False, server_default=""),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    _create_index_if_missing(
        "ix_deliverable_revisions_user_id",
        "deliverable_revisions",
        ["user_id"],
    )
    _create_index_if_missing(
        "ix_deliverable_revisions_deliverable_id",
        "deliverable_revisions",
        ["deliverable_id"],
    )

    _create_table_if_missing(
        "invoice_schedules",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "milestone_id",
            sa.String(36),
            sa.ForeignKey("milestones.id", ondelete="SET NULL"),
        ),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("currency", sa.String(8), nullable=False, server_default="INR"),
        sa.Column("due_date", sa.String(10), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="planned"),
        sa.Column("approval_hash", sa.String(64), nullable=False, server_default=""),
        sa.Column("approved_at", sa.DateTime(timezone=True)),
        sa.Column(
            "invoice_id",
            sa.String(36),
            sa.ForeignKey("invoices.id", ondelete="SET NULL"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    _create_index_if_missing(
        "ix_invoice_schedules_user_id",
        "invoice_schedules",
        ["user_id"],
    )
    _create_index_if_missing(
        "ix_invoice_schedules_project_id",
        "invoice_schedules",
        ["project_id"],
    )

    _create_table_if_missing(
        "delivery_audit_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "deliverable_id",
            sa.String(36),
            sa.ForeignKey("project_deliverables.id", ondelete="SET NULL"),
        ),
        sa.Column("event_type", sa.String(60), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    _create_index_if_missing(
        "ix_delivery_audit_events_user_id",
        "delivery_audit_events",
        ["user_id"],
    )
    _create_index_if_missing(
        "ix_delivery_audit_events_project_id",
        "delivery_audit_events",
        ["project_id"],
    )


def downgrade():
    # This baseline may have created these tables before this revision.
    # Avoid destructive drops that could remove existing user data.
    pass

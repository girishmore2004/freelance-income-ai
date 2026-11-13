"""Marketplace connection and application tracking.

Revision ID: 0014_marketplace_foundation
Revises: 0013_communication_intelligence

The initial baseline migration creates the current SQLAlchemy metadata.
On a fresh database, marketplace tables may already exist when this
historical migration is reached.

This migration therefore creates only missing tables and indexes.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0014_marketplace_foundation"
down_revision = "0013_communication_intelligence"
branch_labels = None
depends_on = None


def _create_table_if_missing(name, *columns, **kwargs):
    bind = op.get_bind()
    existing_tables = set(inspect(bind).get_table_names())

    if name not in existing_tables:
        op.create_table(name, *columns, **kwargs)


def _create_index_if_missing(name, table_name, columns):
    bind = op.get_bind()
    inspector = inspect(bind)

    if table_name not in inspector.get_table_names():
        return

    existing_indexes = {
        item["name"]
        for item in inspector.get_indexes(table_name)
    }

    if name not in existing_indexes:
        op.create_index(name, table_name, columns)


def upgrade():

    # Marketplace connections
    _create_table_if_missing(
        "marketplace_connections",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column(
            "status",
            sa.String(30),
            nullable=False,
            server_default="not_configured",
        ),
        sa.Column(
            "access_mode",
            sa.String(30),
            nullable=False,
            server_default="manual",
        ),
        sa.Column(
            "external_account_id",
            sa.String(255),
            nullable=False,
            server_default="",
        ),
        sa.Column(
            "scopes",
            sa.Text(),
            nullable=False,
            server_default="[]",
        ),
        sa.Column("last_checked_at", sa.DateTime(timezone=True)),
        sa.Column(
            "last_error",
            sa.Text(),
            nullable=False,
            server_default="",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "user_id",
            "provider",
            name="uq_user_marketplace_provider",
        ),
    )

    _create_index_if_missing(
        "ix_marketplace_connections_user_id",
        "marketplace_connections",
        ["user_id"],
    )

    # Marketplace applications
    _create_table_if_missing(
        "marketplace_applications",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "opportunity_id",
            sa.String(36),
            sa.ForeignKey("opportunities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "proposal_id",
            sa.String(36),
            sa.ForeignKey("proposals.id", ondelete="SET NULL"),
        ),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column(
            "external_opportunity_id",
            sa.String(255),
            nullable=False,
            server_default="",
        ),
        sa.Column(
            "external_application_id",
            sa.String(255),
            nullable=False,
            server_default="",
        ),
        sa.Column(
            "status",
            sa.String(30),
            nullable=False,
            server_default="draft",
        ),
        sa.Column(
            "approval_hash",
            sa.String(64),
            nullable=False,
            server_default="",
        ),
        sa.Column("approved_at", sa.DateTime(timezone=True)),
        sa.Column("submitted_at", sa.DateTime(timezone=True)),
        sa.Column(
            "outcome_note",
            sa.Text(),
            nullable=False,
            server_default="",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "user_id",
            "provider",
            "external_opportunity_id",
            name="uq_user_provider_external_application",
        ),
    )

    _create_index_if_missing(
        "ix_marketplace_applications_user_id",
        "marketplace_applications",
        ["user_id"],
    )

    _create_index_if_missing(
        "ix_marketplace_applications_opportunity_id",
        "marketplace_applications",
        ["opportunity_id"],
    )

    # Marketplace audit events
    _create_table_if_missing(
        "marketplace_audit_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "application_id",
            sa.String(36),
            sa.ForeignKey(
                "marketplace_applications.id",
                ondelete="SET NULL",
            ),
        ),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column("event_type", sa.String(60), nullable=False),
        sa.Column(
            "detail",
            sa.Text(),
            nullable=False,
            server_default="",
        ),
        sa.Column(
            "actor",
            sa.String(20),
            nullable=False,
            server_default="system",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
    )

    _create_index_if_missing(
        "ix_marketplace_audit_events_user_id",
        "marketplace_audit_events",
        ["user_id"],
    )

    _create_index_if_missing(
        "ix_marketplace_audit_events_application_id",
        "marketplace_audit_events",
        ["application_id"],
    )


def downgrade():
    # Revision 0001 creates current SQLAlchemy metadata on fresh installs.
    # These tables may therefore predate this revision in the Alembic history.
    # Blindly dropping them could destroy existing user data.
    #
    # This migration is intentionally forward-only.
    pass

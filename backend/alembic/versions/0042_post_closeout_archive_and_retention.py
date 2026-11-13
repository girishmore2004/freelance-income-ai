
"""Add immutable archive manifests and retention review workflow."""

from alembic import op
import sqlalchemy as sa

from app.migration_helpers import (
    table_exists,
    validate_columns,
    ensure_index,
)


revision = "0042_archive_retention"
down_revision = "0041_closeout_signoff"
branch_labels = None
depends_on = None


def _ensure_archive_manifests():
    table = "delivery_archive_manifests"

    if not table_exists(table):
        op.create_table(
            table,
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
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("manifest_json", sa.Text(), nullable=False),
            sa.Column("manifest_hash", sa.String(64), nullable=False),
            sa.Column("created_by", sa.String(36), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint(
                "user_id",
                "project_id",
                "version",
                name="uq_archive_manifest_version",
            ),
        )

    validate_columns(
        table,
        {
            "id", "user_id", "project_id", "version",
            "manifest_json", "manifest_hash", "created_by",
            "created_at",
        },
    )

    for column in ("user_id", "project_id"):
        ensure_index(
            table,
            f"ix_delivery_archive_manifests_{column}",
            [column],
        )


def _ensure_retention_policies():
    table = "project_retention_policies"

    if not table_exists(table):
        op.create_table(
            table,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
                unique=True,
            ),
            sa.Column(
                "retention_days",
                sa.Integer(),
                nullable=False,
                server_default="365",
            ),
            sa.Column(
                "approved_by",
                sa.String(36),
                nullable=False,
                server_default="",
            ),
            sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )

    validate_columns(
        table,
        {
            "id", "user_id", "retention_days", "approved_by",
            "approved_at", "updated_at",
        },
    )

    ensure_index(
        table,
        "ix_project_retention_policies_user_id",
        ["user_id"],
    )


def _ensure_retention_reviews():
    table = "project_retention_reviews"

    if not table_exists(table):
        op.create_table(
            table,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("proposed_days", sa.Integer(), nullable=False),
            sa.Column(
                "status",
                sa.String(20),
                nullable=False,
                server_default="pending",
            ),
            sa.Column(
                "reason",
                sa.Text(),
                nullable=False,
                server_default="",
            ),
            sa.Column("requested_by", sa.String(36), nullable=False),
            sa.Column(
                "decided_by",
                sa.String(36),
                nullable=False,
                server_default="",
            ),
            sa.Column(
                "decision_note",
                sa.Text(),
                nullable=False,
                server_default="",
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        )

    validate_columns(
        table,
        {
            "id", "user_id", "proposed_days", "status", "reason",
            "requested_by", "decided_by", "decision_note",
            "created_at", "decided_at",
        },
    )

    ensure_index(
        table,
        "ix_project_retention_reviews_user_id",
        ["user_id"],
    )


def upgrade():
    _ensure_archive_manifests()
    _ensure_retention_policies()
    _ensure_retention_reviews()


def downgrade():
    # Retention policies are review controls, not automatic deletion rules.
    # Preserve the associated records.
    pass


"""Add archive supersession and recovery rehearsal records."""

from alembic import op
import sqlalchemy as sa

from app.migration_helpers import (
    table_exists,
    validate_columns,
    ensure_index,
)


revision = "0043_archive_supersession"
down_revision = "0042_archive_retention"
branch_labels = None
depends_on = None


def _ensure_supersession_records():
    table = "archive_supersession_records"

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
            sa.Column(
                "superseded_manifest_id",
                sa.String(36),
                sa.ForeignKey(
                    "delivery_archive_manifests.id",
                    ondelete="RESTRICT",
                ),
                nullable=False,
                unique=True,
            ),
            sa.Column(
                "replacement_manifest_id",
                sa.String(36),
                sa.ForeignKey(
                    "delivery_archive_manifests.id",
                    ondelete="RESTRICT",
                ),
                nullable=False,
            ),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("created_by", sa.String(36), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )

    validate_columns(
        table,
        {
            "id", "user_id", "project_id", "superseded_manifest_id",
            "replacement_manifest_id", "reason", "created_by",
            "created_at",
        },
    )

    for column in ("user_id", "project_id", "replacement_manifest_id"):
        ensure_index(
            table,
            f"ix_archive_supersession_records_{column}",
            [column],
        )


def _ensure_recovery_rehearsals():
    table = "project_recovery_rehearsals"

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
            sa.Column(
                "archive_manifest_id",
                sa.String(36),
                sa.ForeignKey(
                    "delivery_archive_manifests.id",
                    ondelete="RESTRICT",
                ),
                nullable=False,
            ),
            sa.Column("overall_status", sa.String(24), nullable=False),
            sa.Column("checklist_json", sa.Text(), nullable=False),
            sa.Column(
                "notes",
                sa.Text(),
                nullable=False,
                server_default="",
            ),
            sa.Column("performed_by", sa.String(36), nullable=False),
            sa.Column("performed_at", sa.DateTime(timezone=True), nullable=False),
        )

    validate_columns(
        table,
        {
            "id", "user_id", "project_id", "archive_manifest_id",
            "overall_status", "checklist_json", "notes",
            "performed_by", "performed_at",
        },
    )

    for column in ("user_id", "project_id", "archive_manifest_id"):
        ensure_index(
            table,
            f"ix_project_recovery_rehearsals_{column}",
            [column],
        )


def upgrade():
    _ensure_supersession_records()
    _ensure_recovery_rehearsals()


def downgrade():
    # Preserve archive lineage and recovery rehearsal evidence.
    pass


"""Create immutable delivery handover snapshots."""

from alembic import op
import sqlalchemy as sa

from app.migration_helpers import (
    table_exists,
    validate_columns,
    ensure_index,
)


revision = "0040_delivery_handover_snapshots"
down_revision = "0039_delivery_issue_root_cause"
branch_labels = None
depends_on = None


TABLE = "delivery_handover_snapshots"

EXPECTED_COLUMNS = {
    "id", "user_id", "project_id", "version",
    "snapshot_json", "snapshot_hash", "input_fingerprint",
    "status", "approved_at", "approved_by", "created_at",
}


def upgrade():
    if not table_exists(TABLE):
        op.create_table(
            TABLE,
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column(
                "user_id",
                sa.String(length=36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "project_id",
                sa.String(length=36),
                sa.ForeignKey("projects.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("snapshot_json", sa.Text(), nullable=False),
            sa.Column("snapshot_hash", sa.String(length=64), nullable=False),
            sa.Column("input_fingerprint", sa.String(length=64), nullable=False),
            sa.Column(
                "status",
                sa.String(length=24),
                nullable=False,
                server_default="draft",
            ),
            sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "approved_by",
                sa.String(length=36),
                nullable=False,
                server_default="",
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint(
                "user_id",
                "project_id",
                "version",
                name="uq_handover_snapshot_version",
            ),
        )

    validate_columns(TABLE, EXPECTED_COLUMNS)

    ensure_index(
        TABLE,
        "ix_delivery_handover_snapshots_user_id",
        ["user_id"],
    )
    ensure_index(
        TABLE,
        "ix_delivery_handover_snapshots_project_id",
        ["project_id"],
    )


def downgrade():
    # Handover snapshots are immutable delivery evidence.
    pass

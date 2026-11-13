
"""Add immutable closeout sign-offs and project closure records."""

from alembic import op
import sqlalchemy as sa

from app.migration_helpers import (
    table_exists,
    validate_columns,
    ensure_index,
)


revision = "0041_closeout_signoff"
down_revision = "0040_delivery_handover_snapshots"
branch_labels = None
depends_on = None


def _ensure_signoffs():
    table = "delivery_closeout_signoffs"

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
                "snapshot_id",
                sa.String(36),
                sa.ForeignKey(
                    "delivery_handover_snapshots.id",
                    ondelete="RESTRICT",
                ),
                nullable=False,
            ),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("snapshot_hash", sa.String(64), nullable=False),
            sa.Column("closeout_fingerprint", sa.String(64), nullable=False),
            sa.Column(
                "signoff_role",
                sa.String(80),
                nullable=False,
                server_default="project_owner",
            ),
            sa.Column(
                "signoff_note",
                sa.Text(),
                nullable=False,
                server_default="",
            ),
            sa.Column(
                "evidence_reference",
                sa.Text(),
                nullable=False,
                server_default="",
            ),
            sa.Column("signed_by", sa.String(36), nullable=False),
            sa.Column("signed_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint(
                "user_id",
                "project_id",
                "version",
                name="uq_closeout_signoff_version",
            ),
        )

    validate_columns(
        table,
        {
            "id", "user_id", "project_id", "snapshot_id",
            "version", "snapshot_hash", "closeout_fingerprint",
            "signoff_role", "signoff_note", "evidence_reference",
            "signed_by", "signed_at",
        },
    )

    for column in ("user_id", "project_id", "snapshot_id"):
        ensure_index(
            table,
            f"ix_delivery_closeout_signoffs_{column}",
            [column],
        )


def _ensure_closure_records():
    table = "project_closure_records"

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
                "signoff_id",
                sa.String(36),
                sa.ForeignKey(
                    "delivery_closeout_signoffs.id",
                    ondelete="RESTRICT",
                ),
                nullable=False,
                unique=True,
            ),
            sa.Column("snapshot_hash", sa.String(64), nullable=False),
            sa.Column("closeout_fingerprint", sa.String(64), nullable=False),
            sa.Column("confirmation_phrase", sa.String(40), nullable=False),
            sa.Column("closed_by", sa.String(36), nullable=False),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column(
                "closure_note",
                sa.Text(),
                nullable=False,
                server_default="",
            ),
        )

    validate_columns(
        table,
        {
            "id", "user_id", "project_id", "signoff_id",
            "snapshot_hash", "closeout_fingerprint",
            "confirmation_phrase", "closed_by", "closed_at",
            "closure_note",
        },
    )

    for column in ("user_id", "project_id"):
        ensure_index(
            table,
            f"ix_project_closure_records_{column}",
            [column],
        )


def upgrade():
    _ensure_signoffs()
    _ensure_closure_records()


def downgrade():
    # Preserve human sign-offs and project closure records.
    pass

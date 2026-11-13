
"""User-entered calendar availability blocks."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0031_calendar_blocks"
down_revision = "0030_task_commitment_planning"
branch_labels = None
depends_on = None


TABLE = "calendar_availability_blocks"

EXPECTED_COLUMNS = {
    "id",
    "user_id",
    "block_date",
    "unavailable_hours",
    "kind",
    "note",
    "created_at",
}


def _inspector():
    return inspect(op.get_bind())


def _ensure_table():
    if TABLE not in _inspector().get_table_names():
        op.create_table(
            TABLE,
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column(
                "user_id",
                sa.String(length=36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("block_date", sa.String(length=10), nullable=False),
            sa.Column(
                "unavailable_hours",
                sa.Float(),
                nullable=False,
                server_default="0",
            ),
            sa.Column(
                "kind",
                sa.String(length=30),
                nullable=False,
                server_default="personal",
            ),
            sa.Column(
                "note",
                sa.String(length=300),
                nullable=False,
                server_default="",
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=True,
            ),
        )

    actual = {
        column["name"]
        for column in _inspector().get_columns(TABLE)
    }

    missing = EXPECTED_COLUMNS - actual

    if missing:
        raise RuntimeError(
            f"{TABLE} has an incompatible schema. "
            f"Missing columns: {sorted(missing)}"
        )


def _ensure_index(name, columns):
    existing = {
        index["name"]
        for index in _inspector().get_indexes(TABLE)
    }

    if name not in existing:
        op.create_index(name, TABLE, columns)


def upgrade():
    _ensure_table()

    _ensure_index(
        "ix_calendar_availability_blocks_user_id",
        ["user_id"],
    )

    _ensure_index(
        "ix_calendar_availability_blocks_block_date",
        ["block_date"],
    )


def downgrade():
    # Preserve user availability records.
    pass

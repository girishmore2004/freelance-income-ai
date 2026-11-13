
"""Add grounded business coach interaction history.

This migration is compatible with the initial schema baseline, which may
already have created coach_interactions and its indexes from SQLAlchemy
metadata.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0018_grounded_business_coach"
down_revision = "0017_business_workspace"
branch_labels = None
depends_on = None


TABLE_NAME = "coach_interactions"

EXPECTED_COLUMNS = {
    "id",
    "user_id",
    "question",
    "answer",
    "sources_json",
    "generation_mode",
    "created_at",
}


def _inspector():
    """Return a fresh inspector so schema checks see the latest changes."""
    return inspect(op.get_bind())


def _table_exists(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _create_table_if_missing() -> None:
    if not _table_exists(TABLE_NAME):
        op.create_table(
            TABLE_NAME,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("question", sa.Text(), nullable=False),
            sa.Column("answer", sa.Text(), nullable=False),
            sa.Column(
                "sources_json",
                sa.Text(),
                nullable=False,
                server_default="[]",
            ),
            sa.Column(
                "generation_mode",
                sa.String(40),
                nullable=False,
                server_default="rules_fallback",
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
            ),
        )

    # Do not silently accept an existing table with an incompatible schema.
    actual_columns = {
        column["name"]
        for column in _inspector().get_columns(TABLE_NAME)
    }

    missing_columns = EXPECTED_COLUMNS - actual_columns

    if missing_columns:
        raise RuntimeError(
            f"Existing {TABLE_NAME} table has an incompatible schema. "
            f"Missing columns: {sorted(missing_columns)}. "
            "A manual schema reconciliation is required."
        )


def _create_index_if_missing(
    index_name: str,
    column_name: str,
) -> None:
    inspector = _inspector()

    existing_indexes = {
        index["name"]
        for index in inspector.get_indexes(TABLE_NAME)
    }

    if index_name not in existing_indexes:
        op.create_index(
            index_name,
            TABLE_NAME,
            [column_name],
        )


def upgrade() -> None:
    _create_table_if_missing()

    _create_index_if_missing(
        "ix_coach_interactions_user_id",
        "user_id",
    )

    _create_index_if_missing(
        "ix_coach_interactions_created_at",
        "created_at",
    )


def downgrade() -> None:
    # The initial metadata baseline may have created this table before
    # revision 0018 was applied. Dropping it could destroy user history.
    # Preserve the table and its data during automatic downgrades.
    pass


"""Persist per-user AI usage and quota abuse events.

Supports databases where these tables and indexes were already created
by the initial SQLAlchemy metadata baseline.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0021_ai_usage_quotas"
down_revision = "0020_agent_workflow_operations"
branch_labels = None
depends_on = None


AI_USAGE_TABLE = "ai_usage_events"
ABUSE_TABLE = "abuse_events"


AI_USAGE_COLUMNS = {
    "id",
    "user_id",
    "operation",
    "provider",
    "input_chars",
    "output_chars",
    "created_at",
}

ABUSE_COLUMNS = {
    "id",
    "user_id",
    "event_type",
    "detail",
    "created_at",
}


def _inspector():
    return inspect(op.get_bind())


def _table_exists(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _validate_table(table_name: str, expected_columns: set[str]) -> None:
    if not _table_exists(table_name):
        raise RuntimeError(
            f"Expected table {table_name!r} was not created."
        )

    actual_columns = {
        column["name"]
        for column in _inspector().get_columns(table_name)
    }

    missing = expected_columns - actual_columns

    if missing:
        raise RuntimeError(
            f"Table {table_name!r} has an incompatible schema. "
            f"Missing columns: {sorted(missing)}. "
            "Migration stopped to prevent silent schema corruption."
        )


def _create_index_if_missing(
    table_name: str,
    index_name: str,
    columns: list[str],
) -> None:
    existing_indexes = {
        index["name"]
        for index in _inspector().get_indexes(table_name)
    }

    if index_name not in existing_indexes:
        op.create_index(
            index_name,
            table_name,
            columns,
        )


def _create_ai_usage_table() -> None:
    if not _table_exists(AI_USAGE_TABLE):
        op.create_table(
            AI_USAGE_TABLE,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("operation", sa.String(80), nullable=False),
            sa.Column("provider", sa.String(40), nullable=False),
            sa.Column(
                "input_chars",
                sa.Integer(),
                nullable=False,
                server_default="0",
            ),
            sa.Column(
                "output_chars",
                sa.Integer(),
                nullable=False,
                server_default="0",
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
            ),
        )

    _validate_table(AI_USAGE_TABLE, AI_USAGE_COLUMNS)

    _create_index_if_missing(
        AI_USAGE_TABLE,
        "ix_ai_usage_events_user_id",
        ["user_id"],
    )

    _create_index_if_missing(
        AI_USAGE_TABLE,
        "ix_ai_usage_events_created_at",
        ["created_at"],
    )


def _create_abuse_table() -> None:
    if not _table_exists(ABUSE_TABLE):
        op.create_table(
            ABUSE_TABLE,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=True,
            ),
            sa.Column("event_type", sa.String(80), nullable=False),
            sa.Column(
                "detail",
                sa.String(500),
                nullable=False,
                server_default="",
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
            ),
        )

    _validate_table(ABUSE_TABLE, ABUSE_COLUMNS)

    _create_index_if_missing(
        ABUSE_TABLE,
        "ix_abuse_events_user_id",
        ["user_id"],
    )

    _create_index_if_missing(
        ABUSE_TABLE,
        "ix_abuse_events_event_type",
        ["event_type"],
    )

    _create_index_if_missing(
        ABUSE_TABLE,
        "ix_abuse_events_created_at",
        ["created_at"],
    )


def upgrade() -> None:
    _create_ai_usage_table()
    _create_abuse_table()


def downgrade() -> None:
    # The initial metadata baseline may have created these tables before
    # this revision. Preserve usage and security audit history.
    pass

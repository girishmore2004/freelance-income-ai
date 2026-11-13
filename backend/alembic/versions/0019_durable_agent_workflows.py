
"""Add durable multi-agent workflow runs and checkpoints.

Compatible with databases where the initial metadata baseline has already
created these tables.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0019_durable_agent_workflows"
down_revision = "0018_grounded_business_coach"
branch_labels = None
depends_on = None


RUNS_TABLE = "agent_workflow_runs"
CHECKPOINTS_TABLE = "agent_workflow_checkpoints"

RUNS_COLUMNS = {
    "id",
    "user_id",
    "workflow_type",
    "idempotency_key",
    "status",
    "current_step",
    "state_json",
    "result_json",
    "error_message",
    "attempt_count",
    "max_attempts",
    "created_at",
    "started_at",
    "updated_at",
    "finished_at",
}

CHECKPOINT_COLUMNS = {
    "id",
    "workflow_id",
    "sequence",
    "node_name",
    "state_json",
    "created_at",
}


def _inspector():
    return inspect(op.get_bind())


def _table_exists(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _validate_columns(table_name: str, expected_columns: set[str]) -> None:
    if not _table_exists(table_name):
        raise RuntimeError(
            f"Expected table {table_name!r} does not exist."
        )

    actual_columns = {
        column["name"]
        for column in _inspector().get_columns(table_name)
    }

    missing_columns = expected_columns - actual_columns

    if missing_columns:
        raise RuntimeError(
            f"Table {table_name!r} has an incompatible schema. "
            f"Missing columns: {sorted(missing_columns)}. "
            "Migration stopped to avoid silently accepting a broken schema."
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


def _create_runs_table() -> None:
    if not _table_exists(RUNS_TABLE):
        op.create_table(
            RUNS_TABLE,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "workflow_type",
                sa.String(40),
                nullable=False,
                server_default="business_review",
            ),
            sa.Column("idempotency_key", sa.String(100), nullable=False),
            sa.Column(
                "status",
                sa.String(30),
                nullable=False,
                server_default="queued",
            ),
            sa.Column(
                "current_step",
                sa.String(80),
                nullable=False,
                server_default="queued",
            ),
            sa.Column(
                "state_json",
                sa.Text(),
                nullable=False,
                server_default="{}",
            ),
            sa.Column(
                "result_json",
                sa.Text(),
                nullable=False,
                server_default="{}",
            ),
            sa.Column(
                "error_message",
                sa.Text(),
                nullable=False,
                server_default="",
            ),
            sa.Column(
                "attempt_count",
                sa.Integer(),
                nullable=False,
                server_default="0",
            ),
            sa.Column(
                "max_attempts",
                sa.Integer(),
                nullable=False,
                server_default="3",
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
            ),
            sa.Column(
                "started_at",
                sa.DateTime(timezone=True),
                nullable=True,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
            ),
            sa.Column(
                "finished_at",
                sa.DateTime(timezone=True),
                nullable=True,
            ),
            sa.UniqueConstraint(
                "user_id",
                "idempotency_key",
                name="uq_agent_workflow_user_idempotency",
            ),
        )

    _validate_columns(RUNS_TABLE, RUNS_COLUMNS)

    _create_index_if_missing(
        RUNS_TABLE,
        "ix_agent_workflow_runs_user_id",
        ["user_id"],
    )

    _create_index_if_missing(
        RUNS_TABLE,
        "ix_agent_workflow_runs_status",
        ["status"],
    )


def _create_checkpoints_table() -> None:
    if not _table_exists(CHECKPOINTS_TABLE):
        op.create_table(
            CHECKPOINTS_TABLE,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "workflow_id",
                sa.String(36),
                sa.ForeignKey(
                    "agent_workflow_runs.id",
                    ondelete="CASCADE",
                ),
                nullable=False,
            ),
            sa.Column("sequence", sa.Integer(), nullable=False),
            sa.Column("node_name", sa.String(80), nullable=False),
            sa.Column(
                "state_json",
                sa.Text(),
                nullable=False,
                server_default="{}",
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
            ),
            sa.UniqueConstraint(
                "workflow_id",
                "sequence",
                name="uq_agent_workflow_checkpoint_sequence",
            ),
        )

    _validate_columns(CHECKPOINTS_TABLE, CHECKPOINT_COLUMNS)

    _create_index_if_missing(
        CHECKPOINTS_TABLE,
        "ix_agent_workflow_checkpoints_workflow_id",
        ["workflow_id"],
    )


def upgrade() -> None:
    _create_runs_table()
    _create_checkpoints_table()


def downgrade() -> None:
    # These tables may have been created by the initial metadata baseline,
    # before this migration was reached. Automatically dropping them could
    # destroy existing workflow history. Preserve data during downgrade.
    pass

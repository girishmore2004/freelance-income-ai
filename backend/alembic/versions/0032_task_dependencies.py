
"""Explicit task dependency edges for delivery sequencing."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0032_task_dependencies"
down_revision = "0031_calendar_blocks"
branch_labels = None
depends_on = None


TABLE = "task_dependencies"

EXPECTED_COLUMNS = {
    "id",
    "user_id",
    "project_id",
    "predecessor_task_id",
    "successor_task_id",
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
            sa.Column(
                "project_id",
                sa.String(length=36),
                sa.ForeignKey("projects.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "predecessor_task_id",
                sa.String(length=36),
                sa.ForeignKey("project_tasks.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "successor_task_id",
                sa.String(length=36),
                sa.ForeignKey("project_tasks.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
            ),
            sa.UniqueConstraint(
                "user_id",
                "predecessor_task_id",
                "successor_task_id",
                name="uq_task_dependency_edge",
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
        "ix_task_dependencies_user_id",
        ["user_id"],
    )

    _ensure_index(
        "ix_task_dependencies_project_id",
        ["project_id"],
    )


def downgrade():
    # Preserve task sequencing history.
    pass

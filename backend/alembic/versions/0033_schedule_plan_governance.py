
"""Approved schedule plan snapshots and planned finish dates."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0033_schedule_plan_governance"
down_revision = "0032_task_dependencies"
branch_labels = None
depends_on = None


TABLE = "schedule_plan_versions"

EXPECTED_COLUMNS = {
    "id",
    "user_id",
    "version",
    "status",
    "input_fingerprint",
    "snapshot",
    "before_after",
    "decision_reason",
    "created_at",
    "decided_at",
}


def _inspector():
    return inspect(op.get_bind())


def _ensure_task_column():
    inspector = _inspector()

    if "project_tasks" not in inspector.get_table_names():
        raise RuntimeError("Required table 'project_tasks' does not exist.")

    columns = {
        column["name"]
        for column in inspector.get_columns("project_tasks")
    }

    if "planned_finish_date" not in columns:
        op.add_column(
            "project_tasks",
            sa.Column(
                "planned_finish_date",
                sa.String(length=10),
                nullable=False,
                server_default="",
            ),
        )


def _ensure_schedule_table():
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
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column(
                "status",
                sa.String(length=20),
                nullable=False,
                server_default="draft",
            ),
            sa.Column(
                "input_fingerprint",
                sa.String(length=64),
                nullable=False,
            ),
            sa.Column("snapshot", sa.JSON(), nullable=False),
            sa.Column("before_after", sa.JSON(), nullable=False),
            sa.Column(
                "decision_reason",
                sa.String(length=500),
                nullable=False,
                server_default="",
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
            ),
            sa.Column(
                "decided_at",
                sa.DateTime(timezone=True),
                nullable=True,
            ),
            sa.UniqueConstraint(
                "user_id",
                "version",
                name="uq_schedule_plan_user_version",
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


def _ensure_index():
    existing = {
        index["name"]
        for index in _inspector().get_indexes(TABLE)
    }

    if "ix_schedule_plan_versions_user_id" not in existing:
        op.create_index(
            "ix_schedule_plan_versions_user_id",
            TABLE,
            ["user_id"],
        )


def upgrade():
    _ensure_task_column()
    _ensure_schedule_table()
    _ensure_index()


def downgrade():
    # Preserve approved schedule snapshots and task planning data.
    pass

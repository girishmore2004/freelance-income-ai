
"""Persist RQ job IDs for durable agent workflow attempts.

Revision ID: 0046_agent_workflow_rq_job_id
Revises: 0045_mfa_and_login_lockout

The stored job ID allows recovery services to inspect the corresponding
RQ job without guessing which queue execution belongs to a workflow.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0046_agent_workflow_rq_job_id"
down_revision = "0045_mfa_and_login_lockout"
branch_labels = None
depends_on = None


TABLE_NAME = "agent_workflow_runs"
COLUMN_NAME = "rq_job_id"


def _inspector():
    return inspect(op.get_bind())


def _table_exists():
    return TABLE_NAME in _inspector().get_table_names()


def _column_exists():
    if not _table_exists():
        return False

    return any(
        column["name"] == COLUMN_NAME
        for column in _inspector().get_columns(TABLE_NAME)
    )


def upgrade():
    if not _table_exists():
        raise RuntimeError(
            "agent_workflow_runs does not exist. "
            "Apply the durable agent workflow migrations first."
        )

    if not _column_exists():
        op.add_column(
            TABLE_NAME,
            sa.Column(
                COLUMN_NAME,
                sa.String(length=100),
                nullable=False,
                server_default="",
            ),
        )


def downgrade():
    if _column_exists():
        op.drop_column(
            TABLE_NAME,
            COLUMN_NAME,
        )

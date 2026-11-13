
"""Persist the RQ job ID for each durable agent workflow.

Revision ID: 0046_agent_workflow_rq_job_id
Revises: 0045_mfa_and_login_lockout
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0046_agent_workflow_rq_job_id"
down_revision = "0045_mfa_and_login_lockout"
branch_labels = None
depends_on = None


def upgrade():
    inspector = inspect(op.get_bind())

    if "agent_workflow_runs" not in inspector.get_table_names():
        raise RuntimeError(
            "agent_workflow_runs table does not exist; "
            "cannot add RQ job tracking."
        )

    columns = {
        column["name"]
        for column in inspector.get_columns("agent_workflow_runs")
    }

    if "rq_job_id" not in columns:
        op.add_column(
            "agent_workflow_runs",
            sa.Column(
                "rq_job_id",
                sa.String(length=100),
                nullable=False,
                server_default="",
            ),
        )


def downgrade():
    inspector = inspect(op.get_bind())

    if "agent_workflow_runs" not in inspector.get_table_names():
        return

    columns = {
        column["name"]
        for column in inspector.get_columns("agent_workflow_runs")
    }

    if "rq_job_id" in columns:
        op.drop_column("agent_workflow_runs", "rq_job_id")
### 2. Update `backend/app/models.py`

Find the existing `AgentWorkflowRun` class (around line 948 in the uploaded version). Replace that class with:

<CodeBlock language="python" editable>
class AgentWorkflowRun(Base):
    __tablename__ = "agent_workflow_runs"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "idempotency_key",
            name="uq_agent_workflow_user_idempotency",
        ),
    )

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=uid,
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    workflow_type: Mapped[str] = mapped_column(
        String(40),
        default="business_review",
    )
    idempotency_key: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(
        String(30),
        default="queued",
        index=True,
    )
    current_step: Mapped[str] = mapped_column(
        String(80),
        default="queued",
    )
    state_json: Mapped[str] = mapped_column(Text, default="{}")
    result_json: Mapped[str] = mapped_column(Text, default="{}")
    error_message: Mapped[str] = mapped_column(Text, default="")
    error_code: Mapped[str] = mapped_column(String(60), default="")
    last_error_node: Mapped[str] = mapped_column(String(80), default="")
    rq_job_id: Mapped[str] = mapped_column(String(100), default="")
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=now,
    )
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=now,
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

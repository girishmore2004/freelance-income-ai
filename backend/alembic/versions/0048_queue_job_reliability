"""Make background_jobs usable for idempotent Cloudflare Queue jobs.

Revision ID: 0048_queue_job_reliability
Revises: 0047_edge_apply_tables

The Edge API consumes the Cloudflare Queue ``freelance-income-ai-jobs`` and
records every job in the existing ``background_jobs`` table (shared with the
Python RQ worker, so ``GET /api/v1/background-jobs`` shows both). This adds:

* ``idempotency_key`` (unique, nullable): enqueueing the same logical job twice
  creates one row and one queue message.
* ``attempts``: delivery attempts recorded by the consumer.
* ``payload_json``: the job input, kept for replay.
* ``source``: ``python`` (RQ) or ``edge`` (Cloudflare Queue).
* ``dead_lettered_at``: when retries were exhausted.
* ``ix_background_jobs_status_created``: for stuck-job and queue-age checks.

All changes are additive with server defaults; existing rows and the Python
worker are unaffected. Downgrade removes only what this revision added.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0048_queue_job_reliability"
down_revision = "0047_edge_apply_tables"
branch_labels = None
depends_on = None

TABLE = "background_jobs"


def _inspector():
    return inspect(op.get_bind())


def _columns() -> set[str]:
    return {column["name"] for column in _inspector().get_columns(TABLE)}


def _indexes() -> set[str]:
    return {index["name"] for index in _inspector().get_indexes(TABLE) if index.get("name")}


def upgrade():
    if TABLE not in _inspector().get_table_names():
        raise RuntimeError("background_jobs does not exist. Apply earlier revisions first.")

    columns = _columns()
    if "idempotency_key" not in columns:
        op.add_column(TABLE, sa.Column("idempotency_key", sa.String(200), nullable=True))
    if "attempts" not in columns:
        op.add_column(TABLE, sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"))
    if "payload_json" not in columns:
        op.add_column(TABLE, sa.Column("payload_json", sa.Text(), nullable=False, server_default="{}"))
    if "source" not in columns:
        op.add_column(TABLE, sa.Column("source", sa.String(30), nullable=False, server_default="python"))
    if "dead_lettered_at" not in columns:
        op.add_column(TABLE, sa.Column("dead_lettered_at", sa.DateTime(timezone=True), nullable=True))

    indexes = _indexes()
    if "uq_background_jobs_idempotency_key" not in indexes and not any(
        list(c.get("column_names") or []) == ["idempotency_key"] for c in _inspector().get_unique_constraints(TABLE)
    ):
        op.create_index("uq_background_jobs_idempotency_key", TABLE, ["idempotency_key"], unique=True)
    if "ix_background_jobs_status_created" not in indexes:
        op.create_index("ix_background_jobs_status_created", TABLE, ["status", "created_at"])


def downgrade():
    indexes = _indexes()
    for name in ("ix_background_jobs_status_created", "uq_background_jobs_idempotency_key"):
        if name in indexes:
            op.drop_index(name, table_name=TABLE)
    columns = _columns()
    for name in ("dead_lettered_at", "source", "payload_json", "attempts", "idempotency_key"):
        if name in columns:
            op.drop_column(TABLE, name)

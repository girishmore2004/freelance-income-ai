"""Feature flags and AI cost estimates for global spend control.

Revision ID: 0049_feature_flags_ai_cost
Revises: 0048_queue_job_reliability

* ``feature_flags``: server-side flags and kill switches (Playbook step 0.8).
  Seeded with safe defaults; unknown flags are treated as OFF by the Edge API.
* ``ai_usage_events.estimated_cost_micros`` and ``service``: lets the Edge API
  enforce a global daily AI budget across all users (finding: no global cap).

Additive only. Downgrade drops the new table and columns (they hold
operational data only, not user content).
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0049_feature_flags_ai_cost"
down_revision = "0048_queue_job_reliability"
branch_labels = None
depends_on = None

SEED_FLAGS = [
    ("ai.generation", True, "Master kill switch for all Edge AI model calls (falls back to safe templates).", "engineering"),
    ("queue.scheduled_discovery", True, "Cron enqueues per-user discovery refresh jobs.", "engineering"),
    ("marketplace.client_side", False, "Client registration, project posting and proposal inbox (Phase 2, not built).", "product"),
    ("payments.live", False, "Real money movement. Must stay OFF until provider, legal and accounting approval.", "founder"),
]


def _inspector():
    return inspect(op.get_bind())


def upgrade():
    tables = _inspector().get_table_names()
    if "ai_usage_events" not in tables:
        raise RuntimeError("ai_usage_events does not exist. Apply earlier revisions first.")

    columns = {c["name"] for c in _inspector().get_columns("ai_usage_events")}
    if "estimated_cost_micros" not in columns:
        op.add_column("ai_usage_events", sa.Column("estimated_cost_micros", sa.Integer(), nullable=False, server_default="0"))
    if "service" not in columns:
        op.add_column("ai_usage_events", sa.Column("service", sa.String(20), nullable=False, server_default="python"))

    if "feature_flags" not in tables:
        op.create_table(
            "feature_flags",
            sa.Column("key", sa.String(80), primary_key=True),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("description", sa.String(300), nullable=False, server_default=""),
            sa.Column("owner", sa.String(80), nullable=False, server_default=""),
            sa.Column("updated_by", sa.String(80), nullable=False, server_default=""),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )

    bind = op.get_bind()
    for key, enabled, description, owner in SEED_FLAGS:
        exists = bind.execute(sa.text("SELECT 1 FROM feature_flags WHERE key = :key"), {"key": key}).first()
        if not exists:
            bind.execute(
                sa.text(
                    "INSERT INTO feature_flags (key, enabled, description, owner, updated_by, updated_at) "
                    "VALUES (:key, :enabled, :description, :owner, 'migration-0049', CURRENT_TIMESTAMP)"
                ),
                {"key": key, "enabled": enabled, "description": description, "owner": owner},
            )


def downgrade():
    if "feature_flags" in _inspector().get_table_names():
        op.drop_table("feature_flags")
    columns = {c["name"] for c in _inspector().get_columns("ai_usage_events")}
    for name in ("service", "estimated_cost_micros"):
        if name in columns:
            op.drop_column("ai_usage_events", name)

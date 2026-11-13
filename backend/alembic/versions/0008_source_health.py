"""Add discovery source health and retry metadata."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0008_source_health"
down_revision = "0007_durable_workflows"
branch_labels = None
depends_on = None

COLUMNS = [
    ("health_status", sa.String(30), False, "unknown"),
    ("consecutive_failures", sa.Integer(), False, "0"),
    ("total_items_seen", sa.Integer(), False, "0"),
    ("last_checked_at", sa.DateTime(timezone=True), True, None),
    ("last_success_at", sa.DateTime(timezone=True), True, None),
    ("next_retry_at", sa.DateTime(timezone=True), True, None),
    ("last_latency_ms", sa.Integer(), True, None),
    ("last_error", sa.Text(), False, ""),
]

def upgrade():
    inspector = inspect(op.get_bind())
    existing = {c["name"] for c in inspector.get_columns("opportunity_sources")}
    for name, typ, nullable, default in COLUMNS:
        if name not in existing:
            kwargs = {"nullable": nullable}
            if default is not None:
                kwargs["server_default"] = sa.text(repr(default)) if isinstance(default, str) else sa.text(default)
            op.add_column("opportunity_sources", sa.Column(name, typ, **kwargs))

def downgrade():
    inspector = inspect(op.get_bind())
    existing = {c["name"] for c in inspector.get_columns("opportunity_sources")}
    for name, *_ in reversed(COLUMNS):
        if name in existing:
            op.drop_column("opportunity_sources", name)

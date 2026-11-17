"""In-app notifications inbox (Phase 7, agent P9).

Revision ID: 0062_notifications_inbox
Revises: 0061_payments_sandbox

Extends the existing ``notifications`` table (created by 0001 from the
models) with ``kind``, ``link``, ``read_at`` and ``dedupe_key`` (unique, so
the same event never notifies twice), plus an index for a user's inbox.
Additive; existing rows keep working. Downgrade drops the added columns.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0062_notifications_inbox"
down_revision = "0061_payments_sandbox"
branch_labels = None
depends_on = None


def _columns() -> set[str]:
    return {c["name"] for c in inspect(op.get_bind()).get_columns("notifications")}


def upgrade():
    tables = set(inspect(op.get_bind()).get_table_names())
    if "notifications" not in tables:
        op.create_table(
            "notifications",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("title", sa.String(240), nullable=False),
            sa.Column("message", sa.Text(), nullable=False),
            sa.Column("channel", sa.String(30), nullable=False, server_default="in_app"),
            sa.Column("status", sa.String(30), nullable=False, server_default="queued"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )
    columns = _columns()
    if "kind" not in columns:
        op.add_column("notifications", sa.Column("kind", sa.String(60), nullable=False, server_default="general"))
    if "link" not in columns:
        op.add_column("notifications", sa.Column("link", sa.String(300), nullable=False, server_default=""))
    if "read_at" not in columns:
        op.add_column("notifications", sa.Column("read_at", sa.DateTime(timezone=True), nullable=True))
    if "dedupe_key" not in columns:
        op.add_column("notifications", sa.Column("dedupe_key", sa.String(200), nullable=True))
        op.create_index("uq_notifications_dedupe", "notifications", ["dedupe_key"], unique=True)
    indexes = {i["name"] for i in inspect(op.get_bind()).get_indexes("notifications")}
    if "ix_notifications_user_created" not in indexes:
        op.create_index("ix_notifications_user_created", "notifications", ["user_id", "created_at"])


def downgrade():
    indexes = {i["name"] for i in inspect(op.get_bind()).get_indexes("notifications")}
    for name in ("ix_notifications_user_created", "uq_notifications_dedupe"):
        if name in indexes:
            op.drop_index(name, table_name="notifications")
    columns = _columns()
    for column in ("dedupe_key", "read_at", "link", "kind"):
        if column in columns:
            op.drop_column("notifications", column)


"""Add per-user scheduled marketplace search preferences."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0029_saved_marketplace_searches"
down_revision = "0028_marketplace_vault"
branch_labels = None
depends_on = None

TABLE = "saved_marketplace_searches"

EXPECTED_COLUMNS = {
    "id", "user_id", "provider", "search_term", "result_limit",
    "interval_hours", "is_active", "last_run_at", "next_run_at",
    "last_result_count", "last_error", "created_at", "updated_at",
}


def _inspector():
    return inspect(op.get_bind())


def _ensure_table():
    if TABLE not in _inspector().get_table_names():
        op.create_table(
            TABLE,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("provider", sa.String(40), nullable=False, server_default="upwork"),
            sa.Column("search_term", sa.String(160), nullable=False),
            sa.Column("result_limit", sa.Integer(), nullable=False, server_default="20"),
            sa.Column("interval_hours", sa.Integer(), nullable=False, server_default="24"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_result_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("last_error", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint(
                "user_id",
                "provider",
                "search_term",
                name="uq_user_provider_saved_search",
            ),
        )

    actual = {c["name"] for c in _inspector().get_columns(TABLE)}
    missing = EXPECTED_COLUMNS - actual
    if missing:
        raise RuntimeError(
            f"{TABLE} has an incompatible schema; missing columns: {sorted(missing)}"
        )


def _ensure_index(name, columns):
    indexes = {i["name"] for i in _inspector().get_indexes(TABLE)}
    if name not in indexes:
        op.create_index(name, TABLE, columns)


def upgrade():
    _ensure_table()
    _ensure_index("ix_saved_marketplace_searches_user_id", ["user_id"])
    _ensure_index("ix_saved_marketplace_searches_next_run_at", ["next_run_at"])


def downgrade():
    # Preserve user-defined marketplace discovery schedules.
    pass

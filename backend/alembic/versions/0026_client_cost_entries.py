
"""Add direct cost records for client profitability."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0026_client_cost_entries"
down_revision = "0025_invoice_payment_ledger"
branch_labels = None
depends_on = None

TABLE = "client_cost_entries"

EXPECTED_COLUMNS = {
    "id", "user_id", "client_id", "project_id", "category",
    "description", "amount", "currency", "cost_date",
    "evidence_reference", "created_at",
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
            sa.Column(
                "client_id",
                sa.String(36),
                sa.ForeignKey("clients.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "project_id",
                sa.String(36),
                sa.ForeignKey("projects.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("category", sa.String(40), nullable=False, server_default="other"),
            sa.Column("description", sa.String(300), nullable=False),
            sa.Column("amount", sa.Float(), nullable=False),
            sa.Column("currency", sa.String(8), nullable=False, server_default="INR"),
            sa.Column("cost_date", sa.String(10), nullable=False),
            sa.Column("evidence_reference", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
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
    _ensure_index("ix_client_cost_entries_user_id", ["user_id"])
    _ensure_index("ix_client_cost_entries_client_id", ["client_id"])
    _ensure_index("ix_client_cost_entries_project_id", ["project_id"])


def downgrade():
    # Preserve client profitability and expense history.
    pass

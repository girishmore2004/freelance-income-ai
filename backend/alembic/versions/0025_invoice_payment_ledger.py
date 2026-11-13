
"""Add append-only invoice payment reconciliation ledger."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0025_invoice_payment_ledger"
down_revision = "0024_contract_delivery_history"
branch_labels = None
depends_on = None

TABLE = "invoice_payment_events"

EXPECTED_COLUMNS = {
    "id", "user_id", "invoice_id", "event_type", "amount",
    "currency", "reference", "evidence_reference", "note",
    "occurred_at", "created_at",
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
                "invoice_id",
                sa.String(36),
                sa.ForeignKey("invoices.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("event_type", sa.String(30), nullable=False),
            sa.Column("amount", sa.Float(), nullable=False, server_default="0"),
            sa.Column("currency", sa.String(8), nullable=False, server_default="INR"),
            sa.Column("reference", sa.String(240), nullable=False, server_default=""),
            sa.Column("evidence_reference", sa.Text(), nullable=False, server_default=""),
            sa.Column("note", sa.Text(), nullable=False, server_default=""),
            sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
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
    _ensure_index("ix_invoice_payment_events_user_id", ["user_id"])
    _ensure_index("ix_invoice_payment_events_invoice_id", ["invoice_id"])
    _ensure_index("ix_invoice_payment_events_occurred_at", ["occurred_at"])


def downgrade():
    # Preserve payment reconciliation evidence. This table may have existed
    # before this revision was applied by the initial metadata baseline.
    pass

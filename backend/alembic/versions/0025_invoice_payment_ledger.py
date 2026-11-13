"""Add append-only invoice payment reconciliation ledger."""
from alembic import op
import sqlalchemy as sa

revision = "0025_invoice_payment_ledger"
down_revision = "0024_contract_delivery_history"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "invoice_payment_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("invoice_id", sa.String(36), sa.ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_type", sa.String(30), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(8), nullable=False, server_default="INR"),
        sa.Column("reference", sa.String(240), nullable=False, server_default=""),
        sa.Column("evidence_reference", sa.Text(), nullable=False, server_default=""),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_invoice_payment_events_user_id", "invoice_payment_events", ["user_id"])
    op.create_index("ix_invoice_payment_events_invoice_id", "invoice_payment_events", ["invoice_id"])
    op.create_index("ix_invoice_payment_events_occurred_at", "invoice_payment_events", ["occurred_at"])


def downgrade():
    op.drop_index("ix_invoice_payment_events_occurred_at", table_name="invoice_payment_events")
    op.drop_index("ix_invoice_payment_events_invoice_id", table_name="invoice_payment_events")
    op.drop_index("ix_invoice_payment_events_user_id", table_name="invoice_payment_events")
    op.drop_table("invoice_payment_events")

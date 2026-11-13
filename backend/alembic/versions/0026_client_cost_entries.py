"""Add direct cost records for client profitability."""
from alembic import op
import sqlalchemy as sa

revision = "0026_client_cost_entries"
down_revision = "0025_invoice_payment_ledger"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "client_cost_entries",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("client_id", sa.String(36), sa.ForeignKey("clients.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True),
        sa.Column("category", sa.String(40), nullable=False, server_default="other"),
        sa.Column("description", sa.String(300), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("currency", sa.String(8), nullable=False, server_default="INR"),
        sa.Column("cost_date", sa.String(10), nullable=False),
        sa.Column("evidence_reference", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_client_cost_entries_user_id", "client_cost_entries", ["user_id"])
    op.create_index("ix_client_cost_entries_client_id", "client_cost_entries", ["client_id"])
    op.create_index("ix_client_cost_entries_project_id", "client_cost_entries", ["project_id"])


def downgrade():
    op.drop_index("ix_client_cost_entries_project_id", table_name="client_cost_entries")
    op.drop_index("ix_client_cost_entries_client_id", table_name="client_cost_entries")
    op.drop_index("ix_client_cost_entries_user_id", table_name="client_cost_entries")
    op.drop_table("client_cost_entries")

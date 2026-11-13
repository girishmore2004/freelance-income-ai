"""Add encrypted per-user marketplace OAuth credential vault."""
from alembic import op
import sqlalchemy as sa

revision = "0028_marketplace_credential_vault"
down_revision = "0027_opportunity_reviews"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "marketplace_credentials",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column("access_token_encrypted", sa.Text(), nullable=False),
        sa.Column("refresh_token_encrypted", sa.Text(), nullable=False, server_default=""),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("scopes", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("status", sa.String(20), nullable=False, server_default="connected"),
        sa.Column("connected_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "provider", name="uq_user_marketplace_credential"),
    )
    op.create_index("ix_marketplace_credentials_user_id", "marketplace_credentials", ["user_id"])
    op.create_index("ix_marketplace_credentials_provider", "marketplace_credentials", ["provider"])


def downgrade():
    op.drop_index("ix_marketplace_credentials_provider", table_name="marketplace_credentials")
    op.drop_index("ix_marketplace_credentials_user_id", table_name="marketplace_credentials")
    op.drop_table("marketplace_credentials")

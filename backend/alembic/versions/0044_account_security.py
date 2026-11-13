"""Add verified-email state, revocable sessions and hashed one-time email tokens."""
from alembic import op
import sqlalchemy as sa

revision = "0044_account_security"
down_revision = "0043_archive_supersession"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_id", sa.String(36), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])
    op.create_index("ix_auth_sessions_token_id", "auth_sessions", ["token_id"])
    op.create_table(
        "email_action_tokens",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("purpose", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_email_action_tokens_user_id", "email_action_tokens", ["user_id"])
    op.create_index("ix_email_action_tokens_token_hash", "email_action_tokens", ["token_hash"])
    op.create_index("ix_email_action_tokens_purpose", "email_action_tokens", ["purpose"])


def downgrade():
    op.drop_index("ix_email_action_tokens_purpose", table_name="email_action_tokens")
    op.drop_index("ix_email_action_tokens_token_hash", table_name="email_action_tokens")
    op.drop_index("ix_email_action_tokens_user_id", table_name="email_action_tokens")
    op.drop_table("email_action_tokens")
    op.drop_index("ix_auth_sessions_token_id", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_user_id", table_name="auth_sessions")
    op.drop_table("auth_sessions")
    op.drop_column("users", "email_verified")

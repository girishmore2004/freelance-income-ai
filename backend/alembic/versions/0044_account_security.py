
"""Add verified-email state, revocable sessions and hashed email tokens."""

from alembic import op
import sqlalchemy as sa

from app.migration_helpers import (
    table_exists,
    ensure_column,
    validate_columns,
    ensure_index,
)


revision = "0044_account_security"
down_revision = "0043_archive_supersession"
branch_labels = None
depends_on = None


def _ensure_auth_sessions():
    table = "auth_sessions"

    if not table_exists(table):
        op.create_table(
            table,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("token_id", sa.String(36), nullable=False, unique=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        )

    validate_columns(
        table,
        {
            "id", "user_id", "token_id",
            "created_at", "expires_at", "revoked_at",
        },
    )

    ensure_index(table, "ix_auth_sessions_user_id", ["user_id"])
    ensure_index(table, "ix_auth_sessions_token_id", ["token_id"])


def _ensure_email_action_tokens():
    table = "email_action_tokens"

    if not table_exists(table):
        op.create_table(
            table,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
            sa.Column("purpose", sa.String(32), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        )

    validate_columns(
        table,
        {
            "id", "user_id", "token_hash", "purpose",
            "created_at", "expires_at", "used_at",
        },
    )

    ensure_index(table, "ix_email_action_tokens_user_id", ["user_id"])
    ensure_index(table, "ix_email_action_tokens_token_hash", ["token_hash"])
    ensure_index(table, "ix_email_action_tokens_purpose", ["purpose"])


def upgrade():
    ensure_column(
        "users",
        sa.Column(
            "email_verified",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )

    _ensure_auth_sessions()
    _ensure_email_action_tokens()


def downgrade():
    # Preserve active/revoked session history and email verification state.
    pass

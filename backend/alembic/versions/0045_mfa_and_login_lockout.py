
"""Add TOTP MFA, recovery codes, challenges and login lockout."""

from alembic import op
import sqlalchemy as sa

from app.migration_helpers import (
    table_exists,
    ensure_column,
    validate_columns,
    ensure_index,
)


revision = "0045_mfa_and_login_lockout"
down_revision = "0044_account_security"
branch_labels = None
depends_on = None


def _ensure_recovery_codes():
    table = "mfa_recovery_codes"

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
            sa.Column("code_hash", sa.String(64), nullable=False, unique=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        )

    validate_columns(
        table,
        {"id", "user_id", "code_hash", "created_at", "used_at"},
    )

    ensure_index(table, "ix_mfa_recovery_codes_user_id", ["user_id"])
    ensure_index(table, "ix_mfa_recovery_codes_code_hash", ["code_hash"])


def _ensure_challenges():
    table = "mfa_challenges"

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
            sa.Column("challenge_id", sa.String(36), nullable=False, unique=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "attempts",
                sa.Integer(),
                nullable=False,
                server_default="0",
            ),
        )

    validate_columns(
        table,
        {
            "id", "user_id", "challenge_id", "created_at",
            "expires_at", "used_at", "attempts",
        },
    )

    ensure_index(table, "ix_mfa_challenges_user_id", ["user_id"])
    ensure_index(table, "ix_mfa_challenges_challenge_id", ["challenge_id"])


def upgrade():
    user_columns = (
        sa.Column(
            "mfa_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "mfa_secret_encrypted",
            sa.Text(),
            nullable=False,
            server_default="",
        ),
        sa.Column(
            "mfa_last_used_step",
            sa.Integer(),
            nullable=True,
        ),
        sa.Column(
            "failed_login_attempts",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "locked_until",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )

    for column in user_columns:
        ensure_column("users", column)

    _ensure_recovery_codes()
    _ensure_challenges()


def downgrade():
    # Preserve MFA configuration, recovery-code history and lockout state.
    pass


"""Add encrypted per-user marketplace OAuth credential vault."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0028_marketplace_vault"
down_revision = "0027_opportunity_reviews"
branch_labels = None
depends_on = None

TABLE = "marketplace_credentials"

EXPECTED_COLUMNS = {
    "id", "user_id", "provider", "access_token_encrypted",
    "refresh_token_encrypted", "token_expires_at", "scopes",
    "status", "connected_at", "updated_at",
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
            sa.Column("provider", sa.String(40), nullable=False),
            sa.Column("access_token_encrypted", sa.Text(), nullable=False),
            sa.Column("refresh_token_encrypted", sa.Text(), nullable=False, server_default=""),
            sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("scopes", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("status", sa.String(20), nullable=False, server_default="connected"),
            sa.Column("connected_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint(
                "user_id",
                "provider",
                name="uq_user_marketplace_credential",
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
    _ensure_index("ix_marketplace_credentials_user_id", ["user_id"])
    _ensure_index("ix_marketplace_credentials_provider", ["provider"])


def downgrade():
    # Never automatically remove encrypted marketplace credentials.
    pass

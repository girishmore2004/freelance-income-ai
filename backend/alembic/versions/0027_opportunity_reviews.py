
"""Add opportunity shortlist and review workflow."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0027_opportunity_reviews"
down_revision = "0026_client_cost_entries"
branch_labels = None
depends_on = None

TABLE = "opportunity_reviews"

EXPECTED_COLUMNS = {
    "id", "user_id", "opportunity_id", "decision", "notes",
    "next_action_date", "created_at", "updated_at",
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
                "opportunity_id",
                sa.String(36),
                sa.ForeignKey("opportunities.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("decision", sa.String(30), nullable=False, server_default="saved"),
            sa.Column("notes", sa.Text(), nullable=False, server_default=""),
            sa.Column("next_action_date", sa.String(10), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint(
                "user_id",
                "opportunity_id",
                name="uq_user_opportunity_review",
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
    _ensure_index("ix_opportunity_reviews_user_id", ["user_id"])
    _ensure_index("ix_opportunity_reviews_opportunity_id", ["opportunity_id"])


def downgrade():
    # Preserve saved opportunity decisions and review notes.
    pass

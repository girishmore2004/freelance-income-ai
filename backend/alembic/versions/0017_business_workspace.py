"""Add business goals and workspace audit events.

Revision ID: 0017_business_workspace
Revises: 0016_proj_opp_attr

The initial schema baseline uses current SQLAlchemy metadata and may
already create these tables and indexes. This migration creates only
objects that are missing.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0017_business_workspace"
down_revision = "0016_proj_opp_attr"
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    return table_name in inspect(op.get_bind()).get_table_names()


def _create_index_if_missing(
    index_name: str,
    table_name: str,
    columns: list[str],
) -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if table_name not in inspector.get_table_names():
        raise RuntimeError(
            f"Cannot create index {index_name}: "
            f"table {table_name} does not exist."
        )

    existing_indexes = {
        index["name"]
        for index in inspector.get_indexes(table_name)
    }

    if index_name not in existing_indexes:
        op.create_index(
            index_name,
            table_name,
            columns,
        )


def upgrade():
    # ---------------------------------------------------------
    # Business goals
    # ---------------------------------------------------------

    if not _table_exists("business_goals"):
        op.create_table(
            "business_goals",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
                unique=True,
            ),
            sa.Column(
                "monthly_income_target",
                sa.Float(),
                nullable=False,
                server_default="0",
            ),
            sa.Column(
                "weekly_hours_target",
                sa.Float(),
                nullable=False,
                server_default="10",
            ),
            sa.Column(
                "monthly_proposals_target",
                sa.Integer(),
                nullable=False,
                server_default="4",
            ),
            sa.Column(
                "monthly_outreach_target",
                sa.Integer(),
                nullable=False,
                server_default="10",
            ),
            sa.Column(
                "currency",
                sa.String(8),
                nullable=False,
                server_default="INR",
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
            ),
        )

    _create_index_if_missing(
        "ix_business_goals_user_id",
        "business_goals",
        ["user_id"],
    )

    # ---------------------------------------------------------
    # Business workspace events
    # ---------------------------------------------------------

    if not _table_exists("business_workspace_events"):
        op.create_table(
            "business_workspace_events",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "event_type",
                sa.String(60),
                nullable=False,
            ),
            sa.Column(
                "entity_type",
                sa.String(60),
                nullable=False,
                server_default="",
            ),
            sa.Column(
                "entity_id",
                sa.String(36),
                nullable=False,
                server_default="",
            ),
            sa.Column(
                "detail",
                sa.Text(),
                nullable=False,
                server_default="",
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
            ),
        )

    _create_index_if_missing(
        "ix_business_workspace_events_user_id",
        "business_workspace_events",
        ["user_id"],
    )

    _create_index_if_missing(
        "ix_business_workspace_events_event_type",
        "business_workspace_events",
        ["event_type"],
    )

    _create_index_if_missing(
        "ix_business_workspace_events_created_at",
        "business_workspace_events",
        ["created_at"],
    )


def downgrade():
    # Do not drop these objects automatically.
    #
    # Revision 0001 may have created them from current metadata,
    # before revision 0017 was recorded. Dropping them here could
    # destroy existing business goals and audit history.
    #
    # A safe downgrade requires an explicit schema ownership strategy.
    pass

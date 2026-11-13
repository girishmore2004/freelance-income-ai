
"""Add client contracts and communication timeline.

Compatible with the initial metadata baseline, which may already have
created these tables and their indexes.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0023_client_ops"
down_revision = "0022_client_crm_scope"
branch_labels = None
depends_on = None


def _inspector():
    return inspect(op.get_bind())


def _table_exists(name: str) -> bool:
    return name in _inspector().get_table_names()


def _validate_table(name: str, expected: set[str]) -> None:
    if not _table_exists(name):
        raise RuntimeError(f"Required table {name!r} does not exist.")

    actual = {
        column["name"]
        for column in _inspector().get_columns(name)
    }

    missing = expected - actual

    if missing:
        raise RuntimeError(
            f"Incompatible schema for {name}: "
            f"missing columns {sorted(missing)}"
        )


def _ensure_index(
    table: str,
    name: str,
    columns: list[str],
) -> None:
    existing = {
        index["name"]
        for index in _inspector().get_indexes(table)
    }

    if name not in existing:
        op.create_index(name, table, columns)


def _create_contracts() -> None:
    table = "client_contracts"

    if not _table_exists(table):
        op.create_table(
            table,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "client_id",
                sa.String(36),
                sa.ForeignKey("clients.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "project_id",
                sa.String(36),
                sa.ForeignKey("projects.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("title", sa.String(240), nullable=False),
            sa.Column(
                "contract_type",
                sa.String(30),
                nullable=False,
                server_default="statement_of_work",
            ),
            sa.Column(
                "version",
                sa.Integer(),
                nullable=False,
                server_default="1",
            ),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column(
                "content_hash",
                sa.String(64),
                nullable=False,
                server_default="",
            ),
            sa.Column(
                "status",
                sa.String(30),
                nullable=False,
                server_default="draft",
            ),
            sa.Column(
                "currency",
                sa.String(8),
                nullable=False,
                server_default="INR",
            ),
            sa.Column(
                "value",
                sa.Float(),
                nullable=False,
                server_default="0",
            ),
            sa.Column(
                "expires_on",
                sa.String(10),
                nullable=False,
                server_default="",
            ),
            sa.Column(
                "decision_note",
                sa.Text(),
                nullable=False,
                server_default="",
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
            ),
        )

    _validate_table(
        table,
        {
            "id", "user_id", "client_id", "project_id",
            "title", "contract_type", "version", "content",
            "content_hash", "status", "currency", "value",
            "expires_on", "decision_note", "created_at",
            "updated_at",
        },
    )

    _ensure_index(table, "ix_client_contracts_user_id", ["user_id"])
    _ensure_index(table, "ix_client_contracts_client_id", ["client_id"])
    _ensure_index(table, "ix_client_contracts_project_id", ["project_id"])


def _create_communication_logs() -> None:
    table = "client_communication_logs"

    if not _table_exists(table):
        op.create_table(
            table,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "client_id",
                sa.String(36),
                sa.ForeignKey("clients.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "project_id",
                sa.String(36),
                sa.ForeignKey("projects.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "channel",
                sa.String(30),
                nullable=False,
                server_default="note",
            ),
            sa.Column(
                "direction",
                sa.String(20),
                nullable=False,
                server_default="internal",
            ),
            sa.Column(
                "subject",
                sa.String(300),
                nullable=False,
                server_default="",
            ),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column(
                "occurred_at",
                sa.DateTime(timezone=True),
                nullable=False,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
            ),
        )

    _validate_table(
        table,
        {
            "id", "user_id", "client_id", "project_id",
            "channel", "direction", "subject", "body",
            "occurred_at", "created_at",
        },
    )

    _ensure_index(
        table,
        "ix_client_communication_logs_user_id",
        ["user_id"],
    )
    _ensure_index(
        table,
        "ix_client_communication_logs_client_id",
        ["client_id"],
    )
    _ensure_index(
        table,
        "ix_client_communication_logs_project_id",
        ["project_id"],
    )


def upgrade() -> None:
    _create_contracts()
    _create_communication_logs()


def downgrade() -> None:
    # Preserve contract and communication history. These tables may have
    # existed before this revision was applied.
    pass

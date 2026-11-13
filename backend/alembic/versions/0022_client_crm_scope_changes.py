
"""Add client CRM and project scope change approvals.

This migration supports the current metadata baseline, which may already
have created clients, scope_change_requests, and projects.client_id.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0022_client_crm_scope"
down_revision = "0021_ai_usage_quotas"
branch_labels = None
depends_on = None


CLIENTS_TABLE = "clients"
SCOPE_TABLE = "scope_change_requests"
PROJECTS_TABLE = "projects"


CLIENT_COLUMNS = {
    "id",
    "user_id",
    "name",
    "company",
    "email",
    "phone",
    "website",
    "notes",
    "tags",
    "status",
    "created_at",
    "updated_at",
}

SCOPE_COLUMNS = {
    "id",
    "user_id",
    "project_id",
    "title",
    "description",
    "reason",
    "budget_delta",
    "currency",
    "timeline_delta_days",
    "status",
    "request_hash",
    "decision_note",
    "client_accepted",
    "client_accepted_at",
    "requested_at",
    "decided_at",
}


def _inspector():
    return inspect(op.get_bind())


def _table_exists(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _validate_columns(
    table_name: str,
    expected_columns: set[str],
) -> None:
    if not _table_exists(table_name):
        raise RuntimeError(
            f"Required table {table_name!r} does not exist."
        )

    actual_columns = {
        column["name"]
        for column in _inspector().get_columns(table_name)
    }

    missing_columns = expected_columns - actual_columns

    if missing_columns:
        raise RuntimeError(
            f"Table {table_name!r} has an incompatible schema. "
            f"Missing columns: {sorted(missing_columns)}."
        )


def _create_index_if_missing(
    table_name: str,
    index_name: str,
    columns: list[str],
) -> None:
    indexes = {
        index["name"]
        for index in _inspector().get_indexes(table_name)
    }

    if index_name not in indexes:
        op.create_index(
            index_name,
            table_name,
            columns,
        )


def _create_clients_table_if_missing() -> None:
    if not _table_exists(CLIENTS_TABLE):
        op.create_table(
            CLIENTS_TABLE,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column(
                "company",
                sa.String(200),
                nullable=False,
                server_default="",
            ),
            sa.Column("email", sa.String(320), nullable=True),
            sa.Column(
                "phone",
                sa.String(40),
                nullable=False,
                server_default="",
            ),
            sa.Column(
                "website",
                sa.String(1200),
                nullable=False,
                server_default="",
            ),
            sa.Column(
                "notes",
                sa.Text(),
                nullable=False,
                server_default="",
            ),
            sa.Column(
                "tags",
                sa.Text(),
                nullable=False,
                server_default="[]",
            ),
            sa.Column(
                "status",
                sa.String(30),
                nullable=False,
                server_default="active",
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
            sa.UniqueConstraint(
                "user_id",
                "email",
                name="uq_client_user_email",
            ),
        )

    _validate_columns(CLIENTS_TABLE, CLIENT_COLUMNS)

    _create_index_if_missing(
        CLIENTS_TABLE,
        "ix_clients_user_id",
        ["user_id"],
    )


def _ensure_project_client_reference() -> None:
    if not _table_exists(PROJECTS_TABLE):
        raise RuntimeError(
            "Cannot add the client reference because the projects table "
            "does not exist."
        )

    project_columns = {
        column["name"]
        for column in _inspector().get_columns(PROJECTS_TABLE)
    }

    if "client_id" not in project_columns:
        op.add_column(
            PROJECTS_TABLE,
            sa.Column(
                "client_id",
                sa.String(36),
                nullable=True,
            ),
        )

    # Check the actual relationship rather than relying on a particular
    # generated constraint name. SQLAlchemy metadata and Alembic may use
    # different names for the same foreign key.
    foreign_keys = _inspector().get_foreign_keys(PROJECTS_TABLE)

    client_fk_exists = any(
        fk.get("constrained_columns") == ["client_id"]
        and fk.get("referred_table") == CLIENTS_TABLE
        and fk.get("referred_columns") == ["id"]
        for fk in foreign_keys
    )

    if not client_fk_exists:
        op.create_foreign_key(
            "fk_projects_client_id_clients",
            PROJECTS_TABLE,
            CLIENTS_TABLE,
            ["client_id"],
            ["id"],
            ondelete="SET NULL",
        )

    _create_index_if_missing(
        PROJECTS_TABLE,
        "ix_projects_client_id",
        ["client_id"],
    )


def _create_scope_change_table_if_missing() -> None:
    if not _table_exists(SCOPE_TABLE):
        op.create_table(
            SCOPE_TABLE,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "project_id",
                sa.String(36),
                sa.ForeignKey("projects.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("title", sa.String(240), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column(
                "reason",
                sa.Text(),
                nullable=False,
                server_default="",
            ),
            sa.Column(
                "budget_delta",
                sa.Float(),
                nullable=False,
                server_default="0",
            ),
            sa.Column(
                "currency",
                sa.String(8),
                nullable=False,
                server_default="INR",
            ),
            sa.Column(
                "timeline_delta_days",
                sa.Integer(),
                nullable=False,
                server_default="0",
            ),
            sa.Column(
                "status",
                sa.String(30),
                nullable=False,
                server_default="draft",
            ),
            sa.Column(
                "request_hash",
                sa.String(64),
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
                "client_accepted",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
            sa.Column(
                "client_accepted_at",
                sa.DateTime(timezone=True),
                nullable=True,
            ),
            sa.Column(
                "requested_at",
                sa.DateTime(timezone=True),
                nullable=False,
            ),
            sa.Column(
                "decided_at",
                sa.DateTime(timezone=True),
                nullable=True,
            ),
        )

    _validate_columns(SCOPE_TABLE, SCOPE_COLUMNS)

    _create_index_if_missing(
        SCOPE_TABLE,
        "ix_scope_change_requests_user_id",
        ["user_id"],
    )

    _create_index_if_missing(
        SCOPE_TABLE,
        "ix_scope_change_requests_project_id",
        ["project_id"],
    )


def upgrade() -> None:
    _create_clients_table_if_missing()
    _ensure_project_client_reference()
    _create_scope_change_table_if_missing()


def downgrade() -> None:
    # The initial metadata baseline may have created these objects before
    # revision 0022. Automatically removing them could destroy client
    # records, project associations, and scope-change approval history.
    #
    # Use a separately planned data-preserving downgrade if one is needed.
    pass

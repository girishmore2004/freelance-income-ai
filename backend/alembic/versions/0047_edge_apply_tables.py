"""Capture Edge API apply-agent tables in the migration chain.

Revision ID: 0047_edge_apply_tables
Revises: 0046_agent_workflow_rq_job_id

The Cloudflare Edge API (backend/edge-api in freelance-income-ai-api-edge)
reads and writes ``integrations``, ``applications`` and
``application_messages``. Before this revision no migration created them,
so a database built only from migrations could not serve the Edge apply,
reply-sync and Gmail routes (Progress Report finding 1).

This migration is written for three starting states:

1. Fresh database: revision 0001 runs ``Base.metadata.create_all`` from the
   current models, which now include these tables. This revision then only
   adds the PostgreSQL-specific pieces (UUID server default, partial unique
   index) and verifies the shape.
2. Existing database without the tables: they are created here.
3. Existing database where the tables were created by hand (suspected for the
   Neon staging database): missing columns are added with safe server
   defaults, required indexes and unique constraints are added, and the
   migration stops with an explicit message if existing rows violate a
   uniqueness rule. No existing column is altered or dropped.

Downgrade is intentionally non-destructive: it removes only the indexes this
revision may have added and leaves the tables and their data in place,
because the tables may pre-date this revision in production.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0047_edge_apply_tables"
down_revision = "0046_agent_workflow_rq_job_id"
branch_labels = None
depends_on = None


def _inspector():
    return inspect(op.get_bind())


def _is_postgres() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def _table_exists(name: str) -> bool:
    return name in _inspector().get_table_names()


def _columns(name: str) -> set[str]:
    return {column["name"] for column in _inspector().get_columns(name)}


def _index_names(name: str) -> set[str]:
    return {index["name"] for index in _inspector().get_indexes(name) if index.get("name")}


def _has_unique(name: str, columns: list[str]) -> bool:
    wanted = list(columns)
    for constraint in _inspector().get_unique_constraints(name):
        if list(constraint.get("column_names") or []) == wanted:
            return True
    for index in _inspector().get_indexes(name):
        if index.get("unique") and list(index.get("column_names") or []) == wanted and not index.get("dialect_options", {}).get("postgresql_where"):
            return True
    return False


def _ensure_column(table: str, column: sa.Column) -> None:
    if column.name not in _columns(table):
        op.add_column(table, column)


def _ensure_index(table: str, name: str, columns: list[str], **kwargs) -> None:
    if name not in _index_names(table):
        op.create_index(name, table, columns, **kwargs)


def _assert_no_duplicates(table: str, columns: list[str], where: str = "") -> None:
    cols = ", ".join(columns)
    condition = f"WHERE {where}" if where else ""
    duplicates = op.get_bind().execute(
        sa.text(f"SELECT {cols}, count(*) AS n FROM {table} {condition} GROUP BY {cols} HAVING count(*) > 1 LIMIT 5")
    ).fetchall()
    if duplicates:
        raise RuntimeError(
            f"Cannot add a uniqueness rule on {table}({cols}): existing rows contain duplicates "
            f"(first examples: {[tuple(row) for row in duplicates]}). Back up the database, remove or merge "
            "the duplicate rows deliberately, then run the migration again. No changes were committed."
        )


def _now_default():
    return sa.text("now()") if _is_postgres() else sa.text("CURRENT_TIMESTAMP")


# ---------------------------------------------------------------------------
# integrations
# ---------------------------------------------------------------------------

def _integrations() -> None:
    table = "integrations"
    if not _table_exists(table):
        op.create_table(
            table,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("provider", sa.String(40), nullable=False),
            sa.Column("email", sa.String(320), nullable=False, server_default=""),
            sa.Column("refresh_token", sa.Text(), nullable=False, server_default=""),
            sa.Column("access_token", sa.Text(), nullable=False, server_default=""),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
            sa.UniqueConstraint("user_id", "provider", name="uq_integrations_user_provider"),
        )
    else:
        _ensure_column(table, sa.Column("email", sa.String(320), nullable=False, server_default=""))
        _ensure_column(table, sa.Column("refresh_token", sa.Text(), nullable=False, server_default=""))
        _ensure_column(table, sa.Column("access_token", sa.Text(), nullable=False, server_default=""))
        _ensure_column(table, sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))
        _ensure_column(table, sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()))
        _ensure_column(table, sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()))
        if not _has_unique(table, ["user_id", "provider"]):
            _assert_no_duplicates(table, ["user_id", "provider"])
            op.create_index("uq_integrations_user_provider", table, ["user_id", "provider"], unique=True)

    required = {"id", "user_id", "provider", "email", "refresh_token", "access_token", "expires_at", "created_at"}
    missing = required - _columns(table)
    if missing:
        raise RuntimeError(f"integrations is missing required columns after migration: {sorted(missing)}")

    _ensure_index(table, "ix_integrations_user_id", ["user_id"])

    if _is_postgres():
        # The Edge INSERT omits id; PostgreSQL 13+ provides gen_random_uuid() natively.
        op.execute("ALTER TABLE integrations ALTER COLUMN id SET DEFAULT gen_random_uuid()::text")


# ---------------------------------------------------------------------------
# applications
# ---------------------------------------------------------------------------

def _applications() -> None:
    table = "applications"
    if not _table_exists(table):
        op.create_table(
            table,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("opportunity_id", sa.String(36), sa.ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False),
            sa.Column("proposal_id", sa.String(36), sa.ForeignKey("proposals.id", ondelete="SET NULL"), nullable=True),
            sa.Column("channel", sa.String(30), nullable=False, server_default="manual"),
            sa.Column("status", sa.String(30), nullable=False, server_default="sent"),
            sa.Column("recipient", sa.String(320), nullable=False, server_default=""),
            sa.Column("external_ref", sa.String(255), nullable=False, server_default=""),
            sa.Column("thread_id", sa.String(255), nullable=False, server_default=""),
            sa.Column("extra", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
        )
    else:
        _ensure_column(table, sa.Column("proposal_id", sa.String(36), nullable=True))
        _ensure_column(table, sa.Column("channel", sa.String(30), nullable=False, server_default="manual"))
        _ensure_column(table, sa.Column("status", sa.String(30), nullable=False, server_default="sent"))
        _ensure_column(table, sa.Column("recipient", sa.String(320), nullable=False, server_default=""))
        _ensure_column(table, sa.Column("external_ref", sa.String(255), nullable=False, server_default=""))
        _ensure_column(table, sa.Column("thread_id", sa.String(255), nullable=False, server_default=""))
        _ensure_column(table, sa.Column("extra", sa.Text(), nullable=False, server_default="{}"))
        _ensure_column(table, sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True))
        _ensure_column(table, sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True))
        _ensure_column(table, sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()))

    required = {"id", "user_id", "opportunity_id", "proposal_id", "channel", "status", "recipient",
                "external_ref", "thread_id", "extra", "sent_at", "last_checked_at", "created_at"}
    missing = required - _columns(table)
    if missing:
        raise RuntimeError(f"applications is missing required columns after migration: {sorted(missing)}")

    _ensure_index(table, "ix_applications_user_id", ["user_id"])
    _ensure_index(table, "ix_applications_opportunity_id", ["opportunity_id"])
    _ensure_index(table, "ix_applications_user_created", ["user_id", "created_at"])
    _ensure_index(table, "ix_applications_status_created", ["status", "created_at"])

    if "uq_applications_live_proposal" not in _index_names(table):
        live = "status IN ('sending', 'sent', 'replied') AND proposal_id IS NOT NULL"
        _assert_no_duplicates(table, ["proposal_id"], live)
        op.create_index(
            "uq_applications_live_proposal",
            table,
            ["proposal_id"],
            unique=True,
            postgresql_where=sa.text("status IN ('sending', 'sent', 'replied')"),
            sqlite_where=sa.text("status IN ('sending', 'sent', 'replied')"),
        )


# ---------------------------------------------------------------------------
# application_messages
# ---------------------------------------------------------------------------

def _application_messages() -> None:
    table = "application_messages"
    if not _table_exists(table):
        op.create_table(
            table,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("application_id", sa.String(36), sa.ForeignKey("applications.id", ondelete="CASCADE"), nullable=False),
            sa.Column("direction", sa.String(8), nullable=False),
            sa.Column("sender", sa.String(300), nullable=False, server_default=""),
            sa.Column("subject", sa.String(300), nullable=False, server_default=""),
            sa.Column("body", sa.Text(), nullable=False, server_default=""),
            sa.Column("external_id", sa.String(255), nullable=False),
            sa.Column("message_ref", sa.String(500), nullable=False, server_default=""),
            sa.Column("received_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
            sa.Column("ai_label", sa.String(40), nullable=False, server_default=""),
            sa.Column("ai_summary", sa.Text(), nullable=False, server_default=""),
            sa.Column("ai_suggestion", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()),
            sa.UniqueConstraint("user_id", "external_id", name="uq_application_messages_user_external"),
        )
    else:
        _ensure_column(table, sa.Column("sender", sa.String(300), nullable=False, server_default=""))
        _ensure_column(table, sa.Column("subject", sa.String(300), nullable=False, server_default=""))
        _ensure_column(table, sa.Column("body", sa.Text(), nullable=False, server_default=""))
        _ensure_column(table, sa.Column("message_ref", sa.String(500), nullable=False, server_default=""))
        _ensure_column(table, sa.Column("received_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()))
        _ensure_column(table, sa.Column("ai_label", sa.String(40), nullable=False, server_default=""))
        _ensure_column(table, sa.Column("ai_summary", sa.Text(), nullable=False, server_default=""))
        _ensure_column(table, sa.Column("ai_suggestion", sa.Text(), nullable=False, server_default=""))
        _ensure_column(table, sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now_default()))
        if not _has_unique(table, ["user_id", "external_id"]):
            _assert_no_duplicates(table, ["user_id", "external_id"])
            op.create_index("uq_application_messages_user_external", table, ["user_id", "external_id"], unique=True)

    required = {"id", "user_id", "application_id", "direction", "sender", "subject", "body", "external_id",
                "message_ref", "received_at", "ai_label", "ai_summary", "ai_suggestion", "created_at"}
    missing = required - _columns(table)
    if missing:
        raise RuntimeError(f"application_messages is missing required columns after migration: {sorted(missing)}")

    _ensure_index(table, "ix_application_messages_user_id", ["user_id"])
    _ensure_index(table, "ix_application_messages_app_received", ["application_id", "received_at"])


def upgrade():
    if not _table_exists("users") or not _table_exists("opportunities") or not _table_exists("proposals"):
        raise RuntimeError("users, opportunities and proposals must exist before 0047. Apply earlier revisions first.")
    _integrations()
    _applications()
    _application_messages()


def downgrade():
    # Non-destructive by design: see module docstring.
    for table, names in (
        ("application_messages", ["ix_application_messages_app_received", "ix_application_messages_user_id"]),
        ("applications", ["uq_applications_live_proposal", "ix_applications_status_created", "ix_applications_user_created"]),
        ("integrations", ["ix_integrations_user_id"]),
    ):
        if _table_exists(table):
            existing = _index_names(table)
            for name in names:
                if name in existing:
                    op.drop_index(name, table_name=table)
    if _is_postgres() and _table_exists("integrations"):
        op.execute("ALTER TABLE integrations ALTER COLUMN id DROP DEFAULT")

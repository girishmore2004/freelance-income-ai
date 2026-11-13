
"""Add immutable contract snapshots and deliverable acceptance history.

The table creation is compatible with the initial metadata baseline.
Historical backfills are guarded to avoid duplicate records.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
import hashlib
import uuid
from datetime import datetime, timezone


revision = "0024_contract_delivery_history"
down_revision = "0023_client_ops"
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
    indexes = {
        index["name"]
        for index in _inspector().get_indexes(table)
    }

    if name not in indexes:
        op.create_index(name, table, columns)


def _create_contract_revisions() -> None:
    table = "client_contract_revisions"

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
                "contract_id",
                sa.String(36),
                sa.ForeignKey("client_contracts.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("title", sa.String(240), nullable=False),
            sa.Column("contract_type", sa.String(30), nullable=False),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("content_hash", sa.String(64), nullable=False),
            sa.Column(
                "previous_hash",
                sa.String(64),
                nullable=False,
                server_default="",
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
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
            ),
            sa.UniqueConstraint(
                "user_id",
                "contract_id",
                "version",
                name="uq_contract_revision_version",
            ),
        )

    _validate_table(
        table,
        {
            "id", "user_id", "contract_id", "version",
            "title", "contract_type", "content", "content_hash",
            "previous_hash", "currency", "value", "expires_on",
            "created_at",
        },
    )

    _ensure_index(
        table,
        "ix_client_contract_revisions_user_id",
        ["user_id"],
    )
    _ensure_index(
        table,
        "ix_client_contract_revisions_contract_id",
        ["contract_id"],
    )


def _create_acceptance_events() -> None:
    table = "deliverable_acceptance_events"

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
                "deliverable_id",
                sa.String(36),
                sa.ForeignKey("project_deliverables.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "revision_version",
                sa.Integer(),
                nullable=False,
                server_default="1",
            ),
            sa.Column(
                "content_hash",
                sa.String(64),
                nullable=False,
                server_default="",
            ),
            sa.Column("decision", sa.String(30), nullable=False),
            sa.Column(
                "note",
                sa.Text(),
                nullable=False,
                server_default="",
            ),
            sa.Column(
                "evidence_reference",
                sa.Text(),
                nullable=False,
                server_default="",
            ),
            sa.Column(
                "recorded_by",
                sa.String(30),
                nullable=False,
                server_default="workspace_owner",
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
            "id", "user_id", "deliverable_id", "revision_version",
            "content_hash", "decision", "note", "evidence_reference",
            "recorded_by", "created_at",
        },
    )

    _ensure_index(
        table,
        "ix_deliverable_acceptance_events_user_id",
        ["user_id"],
    )
    _ensure_index(
        table,
        "ix_deliverable_acceptance_events_deliverable_id",
        ["deliverable_id"],
    )


def _backfill_contract_revisions() -> None:
    conn = op.get_bind()

    contracts = sa.table(
        "client_contracts",
        sa.column("id", sa.String),
        sa.column("user_id", sa.String),
        sa.column("version", sa.Integer),
        sa.column("title", sa.String),
        sa.column("contract_type", sa.String),
        sa.column("content", sa.Text),
        sa.column("content_hash", sa.String),
        sa.column("currency", sa.String),
        sa.column("value", sa.Float),
        sa.column("expires_on", sa.String),
        sa.column("created_at", sa.DateTime),
    )

    revisions = sa.table(
        "client_contract_revisions",
        sa.column("id", sa.String),
        sa.column("user_id", sa.String),
        sa.column("contract_id", sa.String),
        sa.column("version", sa.Integer),
        sa.column("title", sa.String),
        sa.column("contract_type", sa.String),
        sa.column("content", sa.Text),
        sa.column("content_hash", sa.String),
        sa.column("previous_hash", sa.String),
        sa.column("currency", sa.String),
        sa.column("value", sa.Float),
        sa.column("expires_on", sa.String),
        sa.column("created_at", sa.DateTime),
    )

    for row in conn.execute(sa.select(contracts)).mappings():
        version = row["version"] or 1

        existing = conn.execute(
            sa.select(revisions.c.id).where(
                revisions.c.contract_id == row["id"],
                revisions.c.version == version,
            ).limit(1)
        ).first()

        if existing:
            continue

        content = row["content"] or ""
        digest = (
            row["content_hash"]
            or hashlib.sha256(content.encode("utf-8")).hexdigest()
        )

        conn.execute(
            revisions.insert().values(
                id=str(uuid.uuid4()),
                user_id=row["user_id"],
                contract_id=row["id"],
                version=version,
                title=row["title"],
                contract_type=row["contract_type"],
                content=content,
                content_hash=digest,
                previous_hash="",
                currency=row["currency"] or "INR",
                value=row["value"] or 0,
                expires_on=row["expires_on"] or "",
                created_at=row["created_at"] or datetime.now(timezone.utc),
            )
        )


def _backfill_acceptance_history() -> None:
    conn = op.get_bind()

    audit = sa.table(
        "delivery_audit_events",
        sa.column("id", sa.String),
        sa.column("user_id", sa.String),
        sa.column("deliverable_id", sa.String),
        sa.column("event_type", sa.String),
        sa.column("detail", sa.Text),
        sa.column("created_at", sa.DateTime),
    )

    events = sa.table(
        "deliverable_acceptance_events",
        sa.column("id", sa.String),
        sa.column("user_id", sa.String),
        sa.column("deliverable_id", sa.String),
        sa.column("revision_version", sa.Integer),
        sa.column("content_hash", sa.String),
        sa.column("decision", sa.String),
        sa.column("note", sa.Text),
        sa.column("evidence_reference", sa.Text),
        sa.column("recorded_by", sa.String),
        sa.column("created_at", sa.DateTime),
    )

    query = sa.select(audit).where(
        audit.c.event_type.in_(
            ["client_accepted", "client_changes_requested"]
        )
    )

    for row in conn.execute(query).mappings():
        if not row["deliverable_id"]:
            continue

        decision = (
            "accepted"
            if row["event_type"] == "client_accepted"
            else "changes_requested"
        )
        note = row["detail"] or ""
        created_at = row["created_at"] or datetime.now(timezone.utc)

        existing = conn.execute(
            sa.select(events.c.id).where(
                events.c.deliverable_id == row["deliverable_id"],
                events.c.decision == decision,
                events.c.note == note,
                events.c.recorded_by == "historical_migration",
                events.c.created_at == created_at,
            ).limit(1)
        ).first()

        if existing:
            continue

        conn.execute(
            events.insert().values(
                id=str(uuid.uuid4()),
                user_id=row["user_id"],
                deliverable_id=row["deliverable_id"],
                revision_version=1,
                content_hash="",
                decision=decision,
                note=note,
                evidence_reference=(
                    "Historical audit entry; evidence was not separately captured."
                ),
                recorded_by="historical_migration",
                created_at=created_at,
            )
        )


def upgrade() -> None:
    _create_contract_revisions()
    _create_acceptance_events()

    _backfill_contract_revisions()
    _backfill_acceptance_history()


def downgrade() -> None:
    # Preserve immutable contract and acceptance history.
    pass

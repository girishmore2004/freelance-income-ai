
"""Add tamper-evident hash chain to delivery audit events."""

import hashlib
import json

from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0037_delivery_audit_hash_chain"
down_revision = "0036_revision_evidence_links"
branch_labels = None
depends_on = None


def _inspector():
    return inspect(op.get_bind())


def _ensure_column(table, column):
    columns = {
        item["name"]
        for item in _inspector().get_columns(table)
    }

    if column.name not in columns:
        op.add_column(table, column)


def _canonical_timestamp(value):
    if isinstance(value, str):
        value = datetime.fromisoformat(
            value.replace("Z", "+00:00")
        )

    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)

    return value.astimezone(timezone.utc).isoformat(
        timespec="microseconds"
    )


def _digest(row, previous_hash):
    payload = {
        "id": str(row["id"]),
        "user_id": str(row["user_id"]),
        "project_id": str(row["project_id"]),
        "deliverable_id": str(row["deliverable_id"] or ""),
        "event_type": str(row["event_type"]),
        "detail": str(row["detail"] or ""),
        "created_at": _canonical_timestamp(row["created_at"]),
        "previous_hash": str(previous_hash or ""),
        "chain_version": 1,
    }

    encoded = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")

    return hashlib.sha256(encoded).hexdigest()


def _ensure_chain_index():
    indexes = {
        index["name"]
        for index in _inspector().get_indexes(
            "delivery_audit_events"
        )
    }

    index_name = "ix_delivery_audit_events_project_chain"

    if index_name not in indexes:
        op.create_index(
            index_name,
            "delivery_audit_events",
            [
                "user_id",
                "project_id",
                "created_at",
                "id",
            ],
        )


def _backfill_hash_chain():
    bind = op.get_bind()

    rows = bind.execute(
        sa.text(
            """
            SELECT
                id,
                user_id,
                project_id,
                deliverable_id,
                event_type,
                detail,
                created_at
            FROM delivery_audit_events
            ORDER BY user_id, project_id, created_at, id
            """
        )
    ).mappings().all()

    heads = {}

    for row in rows:
        key = (
            str(row["user_id"]),
            str(row["project_id"]),
        )

        previous = heads.get(key, "")
        digest = _digest(row, previous)

        bind.execute(
            sa.text(
                """
                UPDATE delivery_audit_events
                SET
                    previous_hash = :previous,
                    event_hash = :digest,
                    chain_version = 1
                WHERE id = :id
                """
            ),
            {
                "previous": previous,
                "digest": digest,
                "id": row["id"],
            },
        )

        heads[key] = digest

    for (user_id, project_id), head in heads.items():
        bind.execute(
            sa.text(
                """
                UPDATE projects
                SET delivery_audit_head_hash = :head
                WHERE id = :project_id
                  AND user_id = :user_id
                """
            ),
            {
                "head": head,
                "project_id": project_id,
                "user_id": user_id,
            },
        )


def upgrade():
    inspector = _inspector()
    tables = set(inspector.get_table_names())

    if "projects" not in tables:
        raise RuntimeError("Required projects table does not exist.")

    if "delivery_audit_events" not in tables:
        raise RuntimeError(
            "Required delivery_audit_events table does not exist."
        )

    _ensure_column(
        "projects",
        sa.Column(
            "delivery_audit_head_hash",
            sa.String(length=64),
            nullable=False,
            server_default="",
        ),
    )

    _ensure_column(
        "delivery_audit_events",
        sa.Column(
            "previous_hash",
            sa.String(length=64),
            nullable=False,
            server_default="",
        ),
    )

    _ensure_column(
        "delivery_audit_events",
        sa.Column(
            "event_hash",
            sa.String(length=64),
            nullable=False,
            server_default="",
        ),
    )

    _ensure_column(
        "delivery_audit_events",
        sa.Column(
            "chain_version",
            sa.Integer(),
            nullable=False,
            server_default="1",
        ),
    )

    # Rebuilding the chain is deterministic for the same ordered event set.
    # It also repairs rows whose hashes are still blank after a partial run.
    _backfill_hash_chain()

    _ensure_chain_index()


def downgrade():
    # Preserve tamper-evident delivery history.
    # Removing hash columns would destroy the audit chain.
    pass

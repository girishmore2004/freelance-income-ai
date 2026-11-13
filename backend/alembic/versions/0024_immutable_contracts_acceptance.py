"""Add immutable contract snapshots and deliverable acceptance history."""
from alembic import op
import sqlalchemy as sa
import hashlib
import uuid
from datetime import datetime, timezone

revision = "0024_contract_delivery_history"
down_revision = "0023_client_ops"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "client_contract_revisions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("contract_id", sa.String(36), sa.ForeignKey("client_contracts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("contract_type", sa.String(30), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("previous_hash", sa.String(64), nullable=False, server_default=""),
        sa.Column("currency", sa.String(8), nullable=False, server_default="INR"),
        sa.Column("value", sa.Float(), nullable=False, server_default="0"),
        sa.Column("expires_on", sa.String(10), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "contract_id", "version", name="uq_contract_revision_version"),
    )
    op.create_index("ix_client_contract_revisions_user_id", "client_contract_revisions", ["user_id"])
    op.create_index("ix_client_contract_revisions_contract_id", "client_contract_revisions", ["contract_id"])

    op.create_table(
        "deliverable_acceptance_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("deliverable_id", sa.String(36), sa.ForeignKey("project_deliverables.id", ondelete="CASCADE"), nullable=False),
        sa.Column("revision_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("content_hash", sa.String(64), nullable=False, server_default=""),
        sa.Column("decision", sa.String(30), nullable=False),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("evidence_reference", sa.Text(), nullable=False, server_default=""),
        sa.Column("recorded_by", sa.String(30), nullable=False, server_default="workspace_owner"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_deliverable_acceptance_events_user_id", "deliverable_acceptance_events", ["user_id"])
    op.create_index("ix_deliverable_acceptance_events_deliverable_id", "deliverable_acceptance_events", ["deliverable_id"])

    conn = op.get_bind()
    contracts = sa.table("client_contracts",
        sa.column("id", sa.String), sa.column("user_id", sa.String), sa.column("version", sa.Integer),
        sa.column("title", sa.String), sa.column("contract_type", sa.String), sa.column("content", sa.Text),
        sa.column("content_hash", sa.String), sa.column("currency", sa.String), sa.column("value", sa.Float),
        sa.column("expires_on", sa.String), sa.column("created_at", sa.DateTime))
    snapshots = []
    for row in conn.execute(sa.select(contracts)).mappings():
        content = row["content"] or ""
        digest = row["content_hash"] or hashlib.sha256(content.encode("utf-8")).hexdigest()
        snapshots.append({"id": str(uuid.uuid4()), "user_id": row["user_id"], "contract_id": row["id"],
            "version": row["version"] or 1, "title": row["title"], "contract_type": row["contract_type"],
            "content": content, "content_hash": digest, "previous_hash": "", "currency": row["currency"] or "INR",
            "value": row["value"] or 0, "expires_on": row["expires_on"] or "",
            "created_at": row["created_at"] or datetime.now(timezone.utc)})
    if snapshots:
        op.bulk_insert(sa.table("client_contract_revisions",
            sa.column("id", sa.String), sa.column("user_id", sa.String), sa.column("contract_id", sa.String),
            sa.column("version", sa.Integer), sa.column("title", sa.String), sa.column("contract_type", sa.String),
            sa.column("content", sa.Text), sa.column("content_hash", sa.String), sa.column("previous_hash", sa.String),
            sa.column("currency", sa.String), sa.column("value", sa.Float), sa.column("expires_on", sa.String),
            sa.column("created_at", sa.DateTime)), snapshots)

    # Preserve historical client decisions already represented in delivery audit events.
    audit = sa.table("delivery_audit_events", sa.column("id", sa.String), sa.column("user_id", sa.String),
        sa.column("deliverable_id", sa.String), sa.column("event_type", sa.String),
        sa.column("detail", sa.Text), sa.column("created_at", sa.DateTime))
    history = []
    for row in conn.execute(sa.select(audit).where(audit.c.event_type.in_(["client_accepted", "client_changes_requested"]))).mappings():
        if not row["deliverable_id"]:
            continue
        history.append({"id": str(uuid.uuid4()), "user_id": row["user_id"], "deliverable_id": row["deliverable_id"],
            "revision_version": 1, "content_hash": "", "decision": "accepted" if row["event_type"] == "client_accepted" else "changes_requested",
            "note": row["detail"] or "", "evidence_reference": "Historical audit entry; evidence was not separately captured.",
            "recorded_by": "historical_migration", "created_at": row["created_at"] or datetime.now(timezone.utc)})
    if history:
        op.bulk_insert(sa.table("deliverable_acceptance_events",
            sa.column("id", sa.String), sa.column("user_id", sa.String), sa.column("deliverable_id", sa.String),
            sa.column("revision_version", sa.Integer), sa.column("content_hash", sa.String), sa.column("decision", sa.String),
            sa.column("note", sa.Text), sa.column("evidence_reference", sa.Text), sa.column("recorded_by", sa.String),
            sa.column("created_at", sa.DateTime)), history)


def downgrade():
    op.drop_index("ix_deliverable_acceptance_events_deliverable_id", table_name="deliverable_acceptance_events")
    op.drop_index("ix_deliverable_acceptance_events_user_id", table_name="deliverable_acceptance_events")
    op.drop_table("deliverable_acceptance_events")
    op.drop_index("ix_client_contract_revisions_contract_id", table_name="client_contract_revisions")
    op.drop_index("ix_client_contract_revisions_user_id", table_name="client_contract_revisions")
    op.drop_table("client_contract_revisions")

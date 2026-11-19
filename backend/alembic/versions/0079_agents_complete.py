"""Complete the partly built agents (U24).

Revision ID: 0079_agents_complete
Revises: 0078_fair_proposals_blocks

Additive tables and columns:
- ``trust_signals`` (P1): one row each time a message is refused for sharing
  contact details or moving payment off the platform. Read only by staff as
  aggregated patterns; nothing happens to anyone automatically.
- ``discovery_sources.terms_url``, ``permitted_fields``, ``reviewed_at``,
  ``reviewed_by_user_id`` (P5): the source's terms as recorded by an admin.
- ``source_takedowns`` (P5): listings removed at their owner's request; the
  discovery agent never collects them again (unique per source and link).
- ``notification_preferences`` (P9): one row per person and group they changed
  (missing row = on). Account and safety notices cannot be switched off.

Registry (data): F1, F3, F7, F9, F11, C7, P1, P5, P7, P8, P9 move from
``partial`` to ``live``; F3 and C7 gain the run names of their new tools.
Rows an admin changed by hand are left alone.

Downgrade drops the three tables and four columns and restores ``partial``.
"""

import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0079_agents_complete"
down_revision = "0078_fair_proposals_blocks"
branch_labels = None
depends_on = None

NOW = sa.text("CURRENT_TIMESTAMP")

COMPLETED = ["F1", "F3", "F7", "F9", "F11", "C7", "P1", "P5", "P7", "P8", "P9"]
RENAMED = {
    "F3": (["profile_coach"], ["profile_coach", "profile_review"]),
    "C7": (["client_insights"], ["client_insights", "spend_forecast"]),
}


def upgrade():
    bind = op.get_bind()
    insp = inspect(bind)
    tables = set(insp.get_table_names())

    if "trust_signals" not in tables:
        op.create_table(
            "trust_signals",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("kind", sa.String(40), nullable=False),
            sa.Column("context_type", sa.String(20), nullable=False),
            sa.Column("context_id", sa.String(64), nullable=False),
            sa.Column("counterpart_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
            sa.CheckConstraint("kind IN ('contact_attempt', 'payment_attempt')", name="ck_trust_signals_kind"),
            sa.CheckConstraint("context_type IN ('proposal', 'contract')", name="ck_trust_signals_context"),
        )
        op.create_index("ix_trust_signals_user", "trust_signals", ["user_id", "created_at"])
        op.create_index("ix_trust_signals_org", "trust_signals", ["organization_id", "created_at"])

    if "discovery_sources" in tables:
        cols = {c["name"] for c in insp.get_columns("discovery_sources")}
        if "terms_url" not in cols:
            op.add_column("discovery_sources", sa.Column("terms_url", sa.String(1200), nullable=False, server_default=""))
        if "permitted_fields" not in cols:
            op.add_column("discovery_sources", sa.Column("permitted_fields", sa.Text(), nullable=False, server_default=""))
        if "reviewed_at" not in cols:
            op.add_column("discovery_sources", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))
        if "reviewed_by_user_id" not in cols:
            op.add_column("discovery_sources", sa.Column("reviewed_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))

    if "source_takedowns" not in tables:
        op.create_table(
            "source_takedowns",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("source_code", sa.String(40), nullable=False),
            sa.Column("source_url", sa.String(1200), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("removed_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
            sa.UniqueConstraint("source_code", "source_url", name="uq_source_takedowns_link"),
        )

    if "notification_preferences" not in tables:
        op.create_table(
            "notification_preferences",
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("group_key", sa.String(30), primary_key=True),
            sa.Column("in_app", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
            sa.CheckConstraint("group_key IN ('proposals', 'work', 'payments', 'alerts', 'team')", name="ck_notification_preferences_group"),
        )

    if "agent_definitions" in tables:
        for code, (old, new) in RENAMED.items():
            bind.execute(
                sa.text("UPDATE agent_definitions SET runtime_names_json = :new WHERE code = :code AND runtime_names_json = :old"),
                {"code": code, "old": json.dumps(old), "new": json.dumps(new)},
            )
        for code in COMPLETED:
            bind.execute(
                sa.text("UPDATE agent_definitions SET status = 'live', updated_at = CURRENT_TIMESTAMP WHERE code = :code AND status = 'partial'"),
                {"code": code},
            )


def downgrade():
    bind = op.get_bind()
    insp = inspect(bind)
    tables = set(insp.get_table_names())
    if "agent_definitions" in tables:
        for code in COMPLETED:
            bind.execute(
                sa.text("UPDATE agent_definitions SET status = 'partial', updated_at = CURRENT_TIMESTAMP WHERE code = :code AND status = 'live'"),
                {"code": code},
            )
        for code, (old, new) in RENAMED.items():
            bind.execute(
                sa.text("UPDATE agent_definitions SET runtime_names_json = :old WHERE code = :code AND runtime_names_json = :new"),
                {"code": code, "old": json.dumps(old), "new": json.dumps(new)},
            )
    if "notification_preferences" in tables:
        op.drop_table("notification_preferences")
    if "source_takedowns" in tables:
        op.drop_table("source_takedowns")
    if "discovery_sources" in tables:
        cols = {c["name"] for c in insp.get_columns("discovery_sources")}
        for name in ("reviewed_by_user_id", "reviewed_at", "permitted_fields", "terms_url"):
            if name in cols:
                op.drop_column("discovery_sources", name)
    if "trust_signals" in tables:
        op.drop_index("ix_trust_signals_org", table_name="trust_signals")
        op.drop_index("ix_trust_signals_user", table_name="trust_signals")
        op.drop_table("trust_signals")

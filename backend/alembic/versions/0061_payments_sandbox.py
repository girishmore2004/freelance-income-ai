"""Payment flow records: milestone funding, provider events, payouts, invoices (Phase 4).

Revision ID: 0061_payments_sandbox
Revises: 0060_trust_admin

Provider-agnostic tables for the money loop. Every row carries a ``mode``
(``sandbox`` or ``live``). Only the sandbox provider exists in code; live mode
stays refused until D-1/D-2 are approved and a live adapter is written.

* ``payment_intents``: funding of one contract milestone; amounts and both
  fees are locked when funding is created. One open (created/funded) intent
  per milestone.
* ``payment_events``: raw provider events, unique per provider+event id, so
  a repeated webhook is harmless.
* ``payouts``: freelancer withdrawals from their released balance.
* ``billing_invoices``: one per funded milestone (separate from the freelancer's
  own ``invoices`` records), numbered per mode
  (sandbox invoices are marked as test documents, not tax invoices).
* ``contract_cancellations``: a party's request to cancel an active contract;
  the other party accepts or declines.
* Flags ``payments.sandbox`` (test-mode money loop) and
  ``payments.require_funding`` (funded-first, D-3) seeded OFF.

Additive + flag seed. Downgrade drops the five tables and the two flags.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0061_payments_sandbox"
down_revision = "0060_trust_admin"
branch_labels = None
depends_on = None

FLAGS = [
    ("payments.sandbox", False, "Test-mode money loop with the sandbox provider (no real money).", "founder"),
    ("payments.require_funding", False, "Freelancers can deliver a milestone only after it is funded (D-3).", "founder"),
]


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def upgrade():
    tables = _tables()
    if "moderation_actions" not in tables:
        raise RuntimeError("moderation_actions does not exist. Apply 0060 first.")
    now = sa.text("CURRENT_TIMESTAMP")
    mode_check = "mode IN ('sandbox', 'live')"

    if "payment_intents" not in tables:
        op.create_table(
            "payment_intents",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("contract_id", sa.String(36), sa.ForeignKey("contracts.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("milestone_index", sa.Integer(), nullable=False),
            sa.Column("contract_version", sa.Integer(), nullable=False),
            sa.Column("amount_minor", sa.BigInteger(), nullable=False),
            sa.Column("client_fee_minor", sa.BigInteger(), nullable=False),
            sa.Column("freelancer_fee_minor", sa.BigInteger(), nullable=False),
            sa.Column("total_minor", sa.BigInteger(), nullable=False),
            sa.Column("currency", sa.String(3), nullable=False),
            sa.Column("fee_schedule_id", sa.String(36), sa.ForeignKey("fee_schedules.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("provider", sa.String(30), nullable=False),
            sa.Column("provider_ref", sa.String(120), nullable=False, unique=True),
            sa.Column("mode", sa.String(10), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="created"),
            sa.Column("idempotency_key", sa.String(120), nullable=False, unique=True),
            sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.Column("funded_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("refunded_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint(mode_check, name="ck_payment_intents_mode"),
            sa.CheckConstraint("status IN ('created', 'funded', 'released', 'refunded', 'failed', 'cancelled')", name="ck_payment_intents_status"),
            sa.CheckConstraint("amount_minor > 0 AND client_fee_minor >= 0 AND freelancer_fee_minor >= 0 AND freelancer_fee_minor <= amount_minor", name="ck_payment_intents_amounts"),
            sa.CheckConstraint("total_minor = amount_minor + client_fee_minor", name="ck_payment_intents_total"),
            sa.CheckConstraint("milestone_index >= 0 AND milestone_index < 20", name="ck_payment_intents_index"),
        )
        op.create_index("ix_payment_intents_contract", "payment_intents", ["contract_id", "milestone_index"])
        op.create_index(
            "uq_payment_intents_open_milestone", "payment_intents", ["contract_id", "milestone_index"], unique=True,
            postgresql_where=sa.text("status IN ('created', 'funded')"), sqlite_where=sa.text("status IN ('created', 'funded')"),
        )

    if "payment_events" not in tables:
        op.create_table(
            "payment_events",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("provider", sa.String(30), nullable=False),
            sa.Column("event_id", sa.String(120), nullable=False),
            sa.Column("event_type", sa.String(60), nullable=False),
            sa.Column("payload_json", sa.Text(), nullable=False),
            sa.Column("signature_valid", sa.Boolean(), nullable=False),
            sa.Column("source", sa.String(20), nullable=False),
            sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("error", sa.Text(), nullable=False, server_default=""),
            sa.Column("received_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.UniqueConstraint("provider", "event_id", name="uq_payment_events_provider_event"),
            sa.CheckConstraint("source IN ('webhook', 'sandbox')", name="ck_payment_events_source"),
        )

    if "payouts" not in tables:
        op.create_table(
            "payouts",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("amount_minor", sa.BigInteger(), nullable=False),
            sa.Column("currency", sa.String(3), nullable=False),
            sa.Column("provider", sa.String(30), nullable=False),
            sa.Column("provider_ref", sa.String(120), nullable=True),
            sa.Column("mode", sa.String(10), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="requested"),
            sa.Column("idempotency_key", sa.String(120), nullable=False, unique=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint(mode_check, name="ck_payouts_mode"),
            sa.CheckConstraint("status IN ('requested', 'paid', 'failed')", name="ck_payouts_status"),
            sa.CheckConstraint("amount_minor > 0", name="ck_payouts_amount"),
        )
        op.create_index("ix_payouts_user", "payouts", ["user_id", "created_at"])

    if "billing_invoices" not in tables:
        op.create_table(
            "billing_invoices",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("number", sa.String(40), nullable=False, unique=True),
            sa.Column("mode", sa.String(10), nullable=False),
            sa.Column("contract_id", sa.String(36), sa.ForeignKey("contracts.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("payment_intent_id", sa.String(36), sa.ForeignKey("payment_intents.id", ondelete="RESTRICT"), nullable=False, unique=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("milestone_title", sa.String(160), nullable=False),
            sa.Column("amount_minor", sa.BigInteger(), nullable=False),
            sa.Column("client_fee_minor", sa.BigInteger(), nullable=False),
            sa.Column("total_minor", sa.BigInteger(), nullable=False),
            sa.Column("currency", sa.String(3), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="paid"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.CheckConstraint(mode_check, name="ck_billing_invoices_mode"),
            sa.CheckConstraint("status IN ('paid', 'refunded')", name="ck_billing_invoices_status"),
        )
    if "contract_cancellations" not in tables:
        op.create_table(
            "contract_cancellations",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("contract_id", sa.String(36), sa.ForeignKey("contracts.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("requested_by_party", sa.String(20), nullable=False),
            sa.Column("requested_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="open"),
            sa.Column("responded_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint("requested_by_party IN ('client', 'freelancer')", name="ck_contract_cancellations_party"),
            sa.CheckConstraint("status IN ('open', 'accepted', 'declined', 'withdrawn')", name="ck_contract_cancellations_status"),
        )
        op.create_index(
            "uq_contract_cancellations_open", "contract_cancellations", ["contract_id"], unique=True,
            postgresql_where=sa.text("status = 'open'"), sqlite_where=sa.text("status = 'open'"),
        )

    bind = op.get_bind()
    if "feature_flags" in tables:
        for key, enabled, description, owner in FLAGS:
            if not bind.execute(sa.text("SELECT 1 FROM feature_flags WHERE key = :key"), {"key": key}).first():
                bind.execute(
                    sa.text("INSERT INTO feature_flags (key, enabled, description, owner, updated_by, updated_at) VALUES (:key, :enabled, :description, :owner, 'migration', CURRENT_TIMESTAMP)"),
                    {"key": key, "enabled": enabled, "description": description, "owner": owner},
                )


def downgrade():
    tables = _tables()
    for name in ("contract_cancellations", "billing_invoices", "payouts", "payment_events", "payment_intents"):
        if name in tables:
            op.drop_table(name)
    if "feature_flags" in tables:
        op.execute("DELETE FROM feature_flags WHERE key IN ('payments.sandbox', 'payments.require_funding')")

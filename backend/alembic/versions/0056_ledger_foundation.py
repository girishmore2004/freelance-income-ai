"""Double-entry ledger foundation and configurable fee schedules (Phase 4).

Revision ID: 0056_ledger_foundation
Revises: 0055_change_orders_reviews

* ``ledger_accounts``: chart of accounts (asset, liability, revenue, expense,
  equity), optionally owned by an organisation or user, one per code+currency.
* ``ledger_entries``: journal entries with a unique idempotency key and a mode
  (``sandbox`` or ``live``).
* ``ledger_lines``: debit/credit lines in integer minor units.
* PostgreSQL guarantees (not available in SQLite tests):
  - a deferred constraint trigger rejects any entry whose debits and credits
    differ in a currency at commit time;
  - entries and lines are append-only (UPDATE/DELETE raise); corrections are
    reversal entries.
* ``fee_schedules``: fee rates in basis points with a minimum fee. No rows are
  seeded: the fee level is founder decision D-5. Only an ``approved`` schedule
  can be used.

No money moves through this migration. Live posting stays disabled until
D-1/D-2 are approved (``payments.live`` flag OFF).
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0056_ledger_foundation"
down_revision = "0055_change_orders_reviews"
branch_labels = None
depends_on = None

POSTGRES_GUARDS = """
CREATE OR REPLACE FUNCTION ledger_check_balanced() RETURNS trigger AS $$
DECLARE bad record;
BEGIN
  SELECT entry_id, currency INTO bad
  FROM ledger_lines
  WHERE entry_id = NEW.entry_id
  GROUP BY entry_id, currency
  HAVING sum(CASE WHEN direction = 'debit' THEN amount_minor ELSE -amount_minor END) <> 0
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'ledger entry % is not balanced in %', bad.entry_id, bad.currency USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_lines_balanced ON ledger_lines;
CREATE CONSTRAINT TRIGGER ledger_lines_balanced
  AFTER INSERT ON ledger_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();

CREATE OR REPLACE FUNCTION ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger rows are append-only; post a reversal entry instead' USING ERRCODE = '42501';
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_lines_append_only ON ledger_lines;
CREATE TRIGGER ledger_lines_append_only BEFORE UPDATE OR DELETE ON ledger_lines
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

DROP TRIGGER IF EXISTS ledger_entries_append_only ON ledger_entries;
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
"""

DROP_POSTGRES_GUARDS = """
DROP TRIGGER IF EXISTS ledger_entries_append_only ON ledger_entries;
DROP TRIGGER IF EXISTS ledger_lines_append_only ON ledger_lines;
DROP TRIGGER IF EXISTS ledger_lines_balanced ON ledger_lines;
DROP FUNCTION IF EXISTS ledger_append_only();
DROP FUNCTION IF EXISTS ledger_check_balanced();
"""


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def upgrade():
    tables = _tables()
    if "contracts" not in tables:
        raise RuntimeError("contracts does not exist. Apply 0053 first.")
    now = sa.text("CURRENT_TIMESTAMP")

    if "ledger_accounts" not in tables:
        op.create_table(
            "ledger_accounts",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("code", sa.String(160), nullable=False),
            sa.Column("name", sa.String(160), nullable=False),
            sa.Column("kind", sa.String(20), nullable=False),
            sa.Column("currency", sa.String(3), nullable=False),
            sa.Column("owner_type", sa.String(20), nullable=False, server_default="platform"),
            sa.Column("owner_id", sa.String(36), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.UniqueConstraint("code", "currency", name="uq_ledger_account_code"),
            sa.CheckConstraint("kind IN ('asset', 'liability', 'revenue', 'expense', 'equity')", name="ck_ledger_accounts_kind"),
            sa.CheckConstraint("owner_type IN ('platform', 'organization', 'user', 'provider')", name="ck_ledger_accounts_owner"),
        )

    if "ledger_entries" not in tables:
        op.create_table(
            "ledger_entries",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("idempotency_key", sa.String(200), nullable=False, unique=True),
            sa.Column("entry_type", sa.String(60), nullable=False),
            sa.Column("description", sa.String(300), nullable=False, server_default=""),
            sa.Column("mode", sa.String(10), nullable=False),
            sa.Column("contract_id", sa.String(36), sa.ForeignKey("contracts.id", ondelete="RESTRICT"), nullable=True),
            sa.Column("reverses_entry_id", sa.String(36), sa.ForeignKey("ledger_entries.id", ondelete="RESTRICT"), nullable=True),
            sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.CheckConstraint("mode IN ('sandbox', 'live')", name="ck_ledger_entries_mode"),
        )
        op.create_index("ix_ledger_entries_contract", "ledger_entries", ["contract_id", "created_at"])

    if "ledger_lines" not in tables:
        op.create_table(
            "ledger_lines",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("entry_id", sa.String(36), sa.ForeignKey("ledger_entries.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("account_id", sa.String(36), sa.ForeignKey("ledger_accounts.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("direction", sa.String(6), nullable=False),
            sa.Column("amount_minor", sa.BigInteger(), nullable=False),
            sa.Column("currency", sa.String(3), nullable=False),
            sa.CheckConstraint("direction IN ('debit', 'credit')", name="ck_ledger_lines_direction"),
            sa.CheckConstraint("amount_minor > 0", name="ck_ledger_lines_amount"),
        )
        op.create_index("ix_ledger_lines_entry", "ledger_lines", ["entry_id"])
        op.create_index("ix_ledger_lines_account", "ledger_lines", ["account_id"])

    if "fee_schedules" not in tables:
        op.create_table(
            "fee_schedules",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("currency", sa.String(3), nullable=False),
            sa.Column("client_fee_bps", sa.Integer(), nullable=False),
            sa.Column("freelancer_fee_bps", sa.Integer(), nullable=False),
            sa.Column("min_fee_minor", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
            sa.Column("effective_from", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("approved_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.CheckConstraint("client_fee_bps >= 0 AND client_fee_bps <= 3000", name="ck_fee_schedules_client_bps"),
            sa.CheckConstraint("freelancer_fee_bps >= 0 AND freelancer_fee_bps <= 3000", name="ck_fee_schedules_freelancer_bps"),
            sa.CheckConstraint("min_fee_minor >= 0", name="ck_fee_schedules_min"),
            sa.CheckConstraint("status IN ('draft', 'approved', 'retired')", name="ck_fee_schedules_status"),
        )

    if op.get_bind().dialect.name == "postgresql":
        op.execute(POSTGRES_GUARDS)


def downgrade():
    tables = _tables()
    if op.get_bind().dialect.name == "postgresql" and "ledger_lines" in tables:
        op.execute(DROP_POSTGRES_GUARDS)
    for name in ("fee_schedules", "ledger_lines", "ledger_entries", "ledger_accounts"):
        if name in tables:
            op.drop_table(name)

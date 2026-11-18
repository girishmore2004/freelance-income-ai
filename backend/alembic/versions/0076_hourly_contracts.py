"""Hourly contracts: weekly timesheets, time entries and timesheet payments (U19).

Revision ID: 0076_hourly_contracts
Revises: 0075_services_categories

- ``contract_versions.billing_json``: empty for fixed-price terms (all existing
  rows); for hourly terms ``{"type": "hourly", "hourly_rate_minor", "weekly_limit_hours"}``.
- ``contract_timesheets``: one per contract and ISO week (Monday); status
  open → submitted → approved → paid (a returned week goes back to open with
  the client's note). The amount is frozen at submission from minutes × rate.
- ``contract_time_entries``: the freelancer's logged work (1–1440 minutes).
- ``payment_intents.timesheet_id``: an approved week is paid as its own
  intent. The "one open funding per milestone" index now covers milestone
  payments only, and a new index allows one open payment per timesheet.

Additive. Downgrade refuses while hourly payments exist; otherwise it drops
the two tables and the two columns and restores the original index.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0076_hourly_contracts"
down_revision = "0075_services_categories"
branch_labels = None
depends_on = None

NOW = sa.text("CURRENT_TIMESTAMP")
OPEN = "status IN ('created', 'funded')"


def upgrade():
    bind = op.get_bind()
    insp = inspect(bind)
    tables = set(insp.get_table_names())

    if "contract_versions" in tables and "billing_json" not in {c["name"] for c in insp.get_columns("contract_versions")}:
        op.add_column("contract_versions", sa.Column("billing_json", sa.Text(), nullable=False, server_default=""))

    if "contract_timesheets" not in tables:
        op.create_table(
            "contract_timesheets",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("contract_id", sa.String(36), sa.ForeignKey("contracts.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("week_start", sa.Date(), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="open"),
            sa.Column("minutes", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("rate_minor", sa.BigInteger(), nullable=False),
            sa.Column("amount_minor", sa.BigInteger(), nullable=True),
            sa.Column("client_note", sa.Text(), nullable=False, server_default=""),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("decided_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
            sa.CheckConstraint("status IN ('open', 'submitted', 'approved', 'paid')", name="ck_timesheets_status"),
            sa.CheckConstraint("minutes >= 0 AND rate_minor > 0 AND (amount_minor IS NULL OR amount_minor >= 0)", name="ck_timesheets_amounts"),
            sa.UniqueConstraint("contract_id", "week_start", name="uq_timesheets_week"),
        )
        op.create_index("ix_timesheets_status", "contract_timesheets", ["status", "submitted_at"])

    if "contract_time_entries" not in tables:
        op.create_table(
            "contract_time_entries",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("contract_id", sa.String(36), sa.ForeignKey("contracts.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("timesheet_id", sa.String(36), sa.ForeignKey("contract_timesheets.id", ondelete="CASCADE"), nullable=False),
            sa.Column("work_date", sa.Date(), nullable=False),
            sa.Column("minutes", sa.Integer(), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
            sa.CheckConstraint("minutes BETWEEN 1 AND 1440", name="ck_time_entries_minutes"),
        )
        op.create_index("ix_time_entries_sheet", "contract_time_entries", ["timesheet_id", "work_date"])

    if "payment_intents" in tables and "timesheet_id" not in {c["name"] for c in insp.get_columns("payment_intents")}:
        op.add_column("payment_intents", sa.Column("timesheet_id", sa.String(36), sa.ForeignKey("contract_timesheets.id", ondelete="RESTRICT"), nullable=True))
        op.drop_index("uq_payment_intents_open_milestone", table_name="payment_intents")
        op.create_index("uq_payment_intents_open_milestone", "payment_intents", ["contract_id", "milestone_index"], unique=True,
                        postgresql_where=sa.text(f"{OPEN} AND timesheet_id IS NULL"), sqlite_where=sa.text(f"{OPEN} AND timesheet_id IS NULL"))
        op.create_index("uq_payment_intents_open_timesheet", "payment_intents", ["timesheet_id"], unique=True,
                        postgresql_where=sa.text("status IN ('created', 'funded', 'released') AND timesheet_id IS NOT NULL"),
                        sqlite_where=sa.text("status IN ('created', 'funded', 'released') AND timesheet_id IS NOT NULL"))


def downgrade():
    bind = op.get_bind()
    insp = inspect(bind)
    tables = set(insp.get_table_names())
    if "payment_intents" in tables and "timesheet_id" in {c["name"] for c in insp.get_columns("payment_intents")}:
        paid = bind.execute(sa.text("SELECT count(*) FROM payment_intents WHERE timesheet_id IS NOT NULL")).scalar() or 0
        if paid:
            raise RuntimeError(f"{paid} hourly payment(s) exist; downgrading would lose their link to the timesheet. Export them first.")
        op.drop_index("uq_payment_intents_open_timesheet", table_name="payment_intents")
        op.drop_index("uq_payment_intents_open_milestone", table_name="payment_intents")
        op.create_index("uq_payment_intents_open_milestone", "payment_intents", ["contract_id", "milestone_index"], unique=True,
                        postgresql_where=sa.text(OPEN), sqlite_where=sa.text(OPEN))
        op.drop_column("payment_intents", "timesheet_id")
    if "contract_time_entries" in tables:
        op.drop_table("contract_time_entries")
    if "contract_timesheets" in tables:
        op.drop_table("contract_timesheets")
    if "contract_versions" in tables and "billing_json" in {c["name"] for c in insp.get_columns("contract_versions")}:
        op.drop_column("contract_versions", "billing_json")

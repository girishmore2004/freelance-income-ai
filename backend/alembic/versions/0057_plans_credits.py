"""Plans and AI credits as configurable data (Phase 5).

Revision ID: 0057_plans_credits
Revises: 0056_ledger_foundation

* ``plans``: plan catalogue with AI limits and an optional price. Only the
  ``free`` plan is seeded, with today's limits (20 AI calls per day, 300 per
  month), so behaviour does not change. Paid plan prices are founder decision
  D-14 and are not seeded.
* ``user_plans``: a user's current plan (no row = free plan).
* ``ai_credit_ledger``: AI credit balance as signed movements. Grants are
  positive; each AI call beyond the plan's monthly limit spends one credit.
  ``(reason, ref)`` is unique so a call or grant is never counted twice.

Buying plans or credits stays BLOCKED with payments (D-1/D-2).
Additive + seed. Downgrade drops the three tables.
"""

import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0057_plans_credits"
down_revision = "0056_ledger_foundation"
branch_labels = None
depends_on = None

FREE_PLAN = {
    "code": "free",
    "name": "Free",
    "description": "Find work, draft proposals with AI and manage projects.",
    "price_minor": 0,
    "currency": "INR",
    "billing_interval": "month",
    "ai_daily_limit": 20,
    "ai_monthly_limit": 300,
    "features": ["Opportunity discovery", "AI proposal drafts with approval", "Client marketplace access"],
}


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def upgrade():
    tables = _tables()
    if "ledger_entries" not in tables:
        raise RuntimeError("ledger_entries does not exist. Apply 0056 first.")
    now = sa.text("CURRENT_TIMESTAMP")

    if "plans" not in tables:
        op.create_table(
            "plans",
            sa.Column("code", sa.String(40), primary_key=True),
            sa.Column("name", sa.String(80), nullable=False),
            sa.Column("description", sa.String(300), nullable=False, server_default=""),
            sa.Column("price_minor", sa.BigInteger(), nullable=True),
            sa.Column("currency", sa.String(3), nullable=False, server_default="INR"),
            sa.Column("billing_interval", sa.String(10), nullable=False, server_default="month"),
            sa.Column("ai_daily_limit", sa.Integer(), nullable=False),
            sa.Column("ai_monthly_limit", sa.Integer(), nullable=False),
            sa.Column("features_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="100"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.CheckConstraint("price_minor IS NULL OR price_minor >= 0", name="ck_plans_price"),
            sa.CheckConstraint("ai_daily_limit >= 0 AND ai_monthly_limit >= 0", name="ck_plans_limits"),
            sa.CheckConstraint("billing_interval IN ('month', 'year')", name="ck_plans_interval"),
            sa.CheckConstraint("status IN ('draft', 'active', 'retired')", name="ck_plans_status"),
        )

    if "user_plans" not in tables:
        op.create_table(
            "user_plans",
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("plan_code", sa.String(40), sa.ForeignKey("plans.code", ondelete="RESTRICT"), nullable=False),
            sa.Column("source", sa.String(20), nullable=False, server_default="admin"),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("granted_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.CheckConstraint("source IN ('admin', 'purchase', 'promotion')", name="ck_user_plans_source"),
        )

    if "ai_credit_ledger" not in tables:
        op.create_table(
            "ai_credit_ledger",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("delta", sa.Integer(), nullable=False),
            sa.Column("reason", sa.String(20), nullable=False),
            sa.Column("ref", sa.String(100), nullable=False),
            sa.Column("note", sa.String(300), nullable=False, server_default=""),
            sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.UniqueConstraint("reason", "ref", name="uq_ai_credit_ledger_ref"),
            sa.CheckConstraint("delta <> 0", name="ck_ai_credit_ledger_delta"),
            sa.CheckConstraint("reason IN ('grant', 'ai_call', 'adjustment', 'purchase', 'expiry')", name="ck_ai_credit_ledger_reason"),
        )
        op.create_index("ix_ai_credit_ledger_user", "ai_credit_ledger", ["user_id", "created_at"])

    bind = op.get_bind()
    if not bind.execute(sa.text("SELECT 1 FROM plans WHERE code = :code"), {"code": FREE_PLAN["code"]}).first():
        bind.execute(
            sa.text(
                "INSERT INTO plans (code, name, description, price_minor, currency, billing_interval, ai_daily_limit, ai_monthly_limit, "
                "features_json, status, sort_order, created_at, updated_at) VALUES (:code, :name, :description, :price, :currency, "
                ":interval, :daily, :monthly, :features, 'active', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {
                "code": FREE_PLAN["code"], "name": FREE_PLAN["name"], "description": FREE_PLAN["description"],
                "price": FREE_PLAN["price_minor"], "currency": FREE_PLAN["currency"], "interval": FREE_PLAN["billing_interval"],
                "daily": FREE_PLAN["ai_daily_limit"], "monthly": FREE_PLAN["ai_monthly_limit"], "features": json.dumps(FREE_PLAN["features"]),
            },
        )


def downgrade():
    tables = _tables()
    for name in ("ai_credit_ledger", "user_plans", "plans"):
        if name in tables:
            op.drop_table(name)

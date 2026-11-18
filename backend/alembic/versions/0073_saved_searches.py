"""Saved searches with job alerts (U12).

Revision ID: 0073_saved_searches
Revises: 0072_contract_tasks_handover

``saved_searches``: a freelancer's saved Find work filters (words, category,
minimum budget, skills). When a public project is published that matches one
with alerts on, the freelancer gets an in-app notification (once per project).
``last_seen_at`` lets the list show how many matching projects are new.

Additive only. Downgrade drops the table.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0073_saved_searches"
down_revision = "0072_contract_tasks_handover"
branch_labels = None
depends_on = None


def upgrade():
    if "saved_searches" in set(inspect(op.get_bind()).get_table_names()):
        return
    op.create_table(
        "saved_searches",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("query", sa.String(100), nullable=False, server_default=""),
        sa.Column("category_slug", sa.String(60), nullable=False, server_default=""),
        sa.Column("min_budget_minor", sa.BigInteger(), nullable=True),
        sa.Column("skills_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("alerts", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.CheckConstraint("min_budget_minor IS NULL OR min_budget_minor >= 0", name="ck_saved_searches_budget"),
    )
    op.create_index("ix_saved_searches_user", "saved_searches", ["user_id", "created_at"])
    op.create_index("ix_saved_searches_alerts", "saved_searches", ["alerts"])


def downgrade():
    if "saved_searches" in set(inspect(op.get_bind()).get_table_names()):
        op.drop_table("saved_searches")

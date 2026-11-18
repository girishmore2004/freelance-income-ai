"""Contract tasks and handover (U11; delivery workspace tabs "Tasks" and "Handover").

Revision ID: 0072_contract_tasks_handover
Revises: 0071_files_verification_sources

``contract_tasks``: a shared task list per contract. Either party adds tasks
(the client side through owners/admins); a task may belong to a milestone and
says which side does it. A plan can be generated once from the work
category's stages (deterministic, no AI).

``contract_handover_items``: what the freelancer hands over at the end
(source files, documentation, access transfer, deployment notes). The client
confirms receipt of each item. Secrets are refused: access is transferred
through the service's own invitation feature, never by pasting passwords.

Additive only. Downgrade drops both tables.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0072_contract_tasks_handover"
down_revision = "0071_files_verification_sources"
branch_labels = None
depends_on = None


def upgrade():
    tables = set(inspect(op.get_bind()).get_table_names())
    if "contract_tasks" not in tables:
        op.create_table(
            "contract_tasks",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("contract_id", sa.String(36), sa.ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("milestone_index", sa.Integer(), nullable=True),
            sa.Column("owner_party", sa.String(20), nullable=False, server_default="freelancer"),
            sa.Column("due_date", sa.Date(), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="todo"),
            sa.Column("source", sa.String(20), nullable=False, server_default="manual"),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint("owner_party IN ('client', 'freelancer')", name="ck_contract_tasks_party"),
            sa.CheckConstraint("status IN ('todo', 'doing', 'done')", name="ck_contract_tasks_status"),
            sa.CheckConstraint("source IN ('manual', 'category_plan')", name="ck_contract_tasks_source"),
            sa.CheckConstraint("milestone_index IS NULL OR milestone_index >= 0", name="ck_contract_tasks_milestone"),
        )
        op.create_index("ix_contract_tasks_contract", "contract_tasks", ["contract_id", "position"])
    if "contract_handover_items" not in tables:
        op.create_table(
            "contract_handover_items",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("contract_id", sa.String(36), sa.ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False),
            sa.Column("kind", sa.String(30), nullable=False),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("link", sa.String(500), nullable=False, server_default=""),
            sa.Column("note", sa.Text(), nullable=False, server_default=""),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
            sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("confirmed_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint("kind IN ('source_files', 'documentation', 'access_transfer', 'deployment', 'other')", name="ck_handover_kind"),
            sa.CheckConstraint("status IN ('pending', 'confirmed', 'withdrawn')", name="ck_handover_status"),
        )
        op.create_index("ix_handover_contract", "contract_handover_items", ["contract_id", "created_at"])


def downgrade():
    tables = set(inspect(op.get_bind()).get_table_names())
    for name in ("contract_handover_items", "contract_tasks"):
        if name in tables:
            op.drop_table(name)

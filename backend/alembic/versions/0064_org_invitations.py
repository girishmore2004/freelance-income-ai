"""Organisation team invitations (Phase 2 follow-up; K-17).

Revision ID: 0064_org_invitations
Revises: 0063_disputes_suspensions

``organization_invitations``: an owner or admin invites a person by email as
``admin`` or ``member``. Only a SHA-256 hash of the one-time token is stored.
One pending invitation per organisation and email; invitations expire.

Additive. Downgrade drops the table.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0064_org_invitations"
down_revision = "0063_disputes_suspensions"
branch_labels = None
depends_on = None


def upgrade():
    if "organization_invitations" in set(inspect(op.get_bind()).get_table_names()):
        return
    op.create_table(
        "organization_invitations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, server_default="member"),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("invited_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("accepted_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.CheckConstraint("role IN ('admin', 'member')", name="ck_org_invitations_role"),
        sa.CheckConstraint("status IN ('pending', 'accepted', 'declined', 'revoked')", name="ck_org_invitations_status"),
        sa.UniqueConstraint("token_hash", name="uq_org_invitations_token"),
    )
    op.create_index("ix_org_invitations_org", "organization_invitations", ["organization_id", "status"])
    op.create_index("ix_org_invitations_email", "organization_invitations", ["email", "status"])
    op.create_index(
        "uq_org_invitations_pending", "organization_invitations", ["organization_id", "email"], unique=True,
        postgresql_where=sa.text("status = 'pending'"), sqlite_where=sa.text("status = 'pending'"),
    )


def downgrade():
    if "organization_invitations" in set(inspect(op.get_bind()).get_table_names()):
        op.drop_table("organization_invitations")

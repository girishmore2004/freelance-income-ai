"""Identity foundation: user roles, organisations and memberships (Phase 1).

Revision ID: 0050_identity_roles_orgs
Revises: 0049_feature_flags_ai_cost

Master Plan Part A "User account model": one login, public roles
"freelancer" and "client"; internal roles admin/support/moderator/finance;
client accounts as individual or company organisations with billing identity.

Backfill: every existing user receives the active "freelancer" role, which
matches what the product offered until now. No other data changes.

Check constraints keep role, kind and status values valid at the database
level. Downgrade drops the three new tables (they hold no pre-existing data).
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0050_identity_roles_orgs"
down_revision = "0049_feature_flags_ai_cost"
branch_labels = None
depends_on = None

ROLES = "('freelancer', 'client', 'admin', 'support', 'moderator', 'finance')"


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def upgrade():
    tables = _tables()
    if "users" not in tables:
        raise RuntimeError("users does not exist. Apply earlier revisions first.")
    now = sa.text("CURRENT_TIMESTAMP")

    if "user_roles" not in tables:
        op.create_table(
            "user_roles",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("role", sa.String(20), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="active"),
            sa.Column("granted_by", sa.String(80), nullable=False, server_default="self"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.UniqueConstraint("user_id", "role", name="uq_user_roles_user_role"),
            sa.CheckConstraint(f"role IN {ROLES}", name="ck_user_roles_role"),
            sa.CheckConstraint("status IN ('active', 'inactive', 'suspended')", name="ck_user_roles_status"),
        )
        op.create_index("ix_user_roles_user_id", "user_roles", ["user_id"])
        op.create_index("ix_user_roles_role", "user_roles", ["role"])

    if "organizations" not in tables:
        op.create_table(
            "organizations",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("name", sa.String(160), nullable=False),
            sa.Column("kind", sa.String(20), nullable=False, server_default="individual"),
            sa.Column("industry", sa.String(120), nullable=False, server_default=""),
            sa.Column("website", sa.String(300), nullable=False, server_default=""),
            sa.Column("country", sa.String(2), nullable=False, server_default="IN"),
            sa.Column("preferred_language", sa.String(20), nullable=False, server_default="en"),
            sa.Column("billing_name", sa.String(200), nullable=False, server_default=""),
            sa.Column("billing_email", sa.String(320), nullable=False, server_default=""),
            sa.Column("billing_address", sa.Text(), nullable=False, server_default=""),
            sa.Column("tax_id", sa.String(40), nullable=False, server_default=""),
            sa.Column("status", sa.String(20), nullable=False, server_default="active"),
            sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.CheckConstraint("kind IN ('individual', 'company')", name="ck_organizations_kind"),
            sa.CheckConstraint("status IN ('active', 'suspended', 'closed')", name="ck_organizations_status"),
        )
        op.create_index("ix_organizations_created_by", "organizations", ["created_by"])

    if "organization_memberships" not in tables:
        op.create_table(
            "organization_memberships",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("role", sa.String(20), nullable=False, server_default="member"),
            sa.Column("status", sa.String(20), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.UniqueConstraint("organization_id", "user_id", name="uq_org_membership"),
            sa.CheckConstraint("role IN ('owner', 'admin', 'member')", name="ck_org_membership_role"),
            sa.CheckConstraint("status IN ('active', 'invited', 'removed')", name="ck_org_membership_status"),
        )
        op.create_index("ix_organization_memberships_organization_id", "organization_memberships", ["organization_id"])
        op.create_index("ix_organization_memberships_user_id", "organization_memberships", ["user_id"])

    # Backfill: existing accounts were freelancer accounts.
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            "INSERT INTO user_roles (id, user_id, role, status, granted_by, created_at, updated_at) "
            "SELECT gen_random_uuid()::text, u.id, 'freelancer', 'active', 'migration-0050', now(), now() "
            "FROM users u WHERE NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'freelancer')"
        )
    else:
        import uuid
        users = bind.execute(sa.text(
            "SELECT id FROM users u WHERE NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'freelancer')"
        )).fetchall()
        for (user_id,) in users:
            bind.execute(
                sa.text("INSERT INTO user_roles (id, user_id, role, status, granted_by, created_at, updated_at) "
                        "VALUES (:id, :user_id, 'freelancer', 'active', 'migration-0050', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"),
                {"id": str(uuid.uuid4()), "user_id": user_id},
            )


def downgrade():
    tables = _tables()
    for name in ("organization_memberships", "organizations", "user_roles"):
        if name in tables:
            op.drop_table(name)

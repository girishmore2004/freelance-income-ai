"""Service catalogue (freelancers sell packages, clients order) and open categories (U18).

Revision ID: 0075_services_categories
Revises: 0074_profile_projects

Decisions recorded 2026-11-18 (BUSINESS_DECISIONS D-6, D-20):
- every work category opens for posting; admins can switch each one off again;
- freelancers may publish ready-made services with up to three packages
  (Fiverr-style). Ordering a package creates an ordinary two-party contract,
  so delivery, test-mode payments, reviews and disputes are reused unchanged.

Schema:
- ``services``: one service per row; packages as validated JSON; status
  draft | in_review | published | paused | removed (screened like projects).
- ``service_orders``: the link between an order and its contract, with a
  snapshot of the package bought and the client's requirements.
- ``contracts.listing_id`` / ``proposal_id`` become nullable: a contract made
  from a service order has no project or proposal. Existing rows keep theirs.
- ``reports`` may target a ``service``.

Downgrade refuses to run while service-order contracts exist (making the
columns NOT NULL again would fail); otherwise it reverses everything and
switches all categories except website development off.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0075_services_categories"
down_revision = "0074_profile_projects"
branch_labels = None
depends_on = None

NOW = sa.text("CURRENT_TIMESTAMP")
REPORT_TARGETS_OLD = "target_type IN ('listing', 'user', 'proposal', 'contract_message', 'review')"
REPORT_TARGETS_NEW = "target_type IN ('listing', 'user', 'proposal', 'contract_message', 'review', 'service')"


def upgrade():
    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    postgres = bind.dialect.name == "postgresql"

    if "project_categories" in tables:
        bind.execute(sa.text("UPDATE project_categories SET enabled = TRUE, updated_at = CURRENT_TIMESTAMP WHERE enabled = FALSE"))

    if "services" not in tables:
        op.create_table(
            "services",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("freelancer_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("category_slug", sa.String(60), sa.ForeignKey("project_categories.slug", ondelete="RESTRICT"), nullable=False),
            sa.Column("title", sa.String(120), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("skills_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("packages_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("requirements", sa.Text(), nullable=False, server_default=""),
            sa.Column("currency", sa.String(8), nullable=False, server_default="INR"),
            sa.Column("min_price_minor", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
            sa.Column("moderation_note", sa.Text(), nullable=False, server_default=""),
            sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
            sa.CheckConstraint("status IN ('draft', 'in_review', 'published', 'paused', 'removed')", name="ck_services_status"),
            sa.CheckConstraint("min_price_minor >= 0", name="ck_services_price"),
        )
        op.create_index("ix_services_market", "services", ["status", "category_slug", "published_at"])
        op.create_index("ix_services_freelancer", "services", ["freelancer_user_id", "created_at"])

    if "service_orders" not in tables:
        op.create_table(
            "service_orders",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("service_id", sa.String(36), sa.ForeignKey("services.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("contract_id", sa.String(36), sa.ForeignKey("contracts.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("client_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("freelancer_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("package_key", sa.String(20), nullable=False),
            sa.Column("package_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("price_minor", sa.BigInteger(), nullable=False),
            sa.Column("delivery_days", sa.Integer(), nullable=False),
            sa.Column("client_requirements", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
            sa.CheckConstraint("package_key IN ('basic', 'standard', 'premium')", name="ck_service_orders_package"),
            sa.CheckConstraint("price_minor > 0 AND delivery_days BETWEEN 1 AND 90", name="ck_service_orders_terms"),
            sa.UniqueConstraint("contract_id", name="uq_service_orders_contract"),
        )
        op.create_index("ix_service_orders_service", "service_orders", ["service_id", "created_at"])
        op.create_index("ix_service_orders_org", "service_orders", ["organization_id", "created_at"])

    if "contracts" in tables:
        cols = {c["name"]: c for c in inspect(bind).get_columns("contracts")}
        if postgres:
            if not cols["listing_id"]["nullable"]:
                op.alter_column("contracts", "listing_id", existing_type=sa.String(36), nullable=True)
            if not cols["proposal_id"]["nullable"]:
                op.alter_column("contracts", "proposal_id", existing_type=sa.String(36), nullable=True)

    if "reports" in tables and postgres:
        op.execute("ALTER TABLE reports DROP CONSTRAINT IF EXISTS ck_reports_target")
        op.execute(f"ALTER TABLE reports ADD CONSTRAINT ck_reports_target CHECK ({REPORT_TARGETS_NEW})")


def downgrade():
    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    postgres = bind.dialect.name == "postgresql"
    if "contracts" in tables:
        orphan = bind.execute(sa.text("SELECT count(*) FROM contracts WHERE listing_id IS NULL OR proposal_id IS NULL")).scalar() or 0
        if orphan:
            raise RuntimeError(
                f"{orphan} contract(s) were created from service orders and have no project. "
                "Downgrading would break them; export and remove them first."
            )
    if "reports" in tables and postgres:
        bind.execute(sa.text("DELETE FROM reports WHERE target_type = 'service'"))
        op.execute("ALTER TABLE reports DROP CONSTRAINT IF EXISTS ck_reports_target")
        op.execute(f"ALTER TABLE reports ADD CONSTRAINT ck_reports_target CHECK ({REPORT_TARGETS_OLD})")
    if "contracts" in tables and postgres:
        op.alter_column("contracts", "proposal_id", existing_type=sa.String(36), nullable=False)
        op.alter_column("contracts", "listing_id", existing_type=sa.String(36), nullable=False)
    if "service_orders" in tables:
        op.drop_table("service_orders")
    if "services" in tables:
        op.drop_table("services")
    if "project_categories" in tables:
        bind.execute(sa.text("UPDATE project_categories SET enabled = FALSE WHERE slug <> 'website_development'"))

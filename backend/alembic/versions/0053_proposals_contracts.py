"""Hiring loop: proposals on native listings, offers and two-party contracts (Phase 3).

Revision ID: 0053_proposals_contracts
Revises: 0052_invites_saved_freelancers

* ``listing_proposals``: one proposal per freelancer and listing. The price is
  set by the freelancer in integer minor units.
* ``contracts``: an offer made by the client organisation from a proposal.
  Becomes ``active`` only when both parties accepted the same version.
  At most one open (offered/active) contract per proposal.
* ``contract_versions``: immutable terms (scope, milestones with amounts,
  total, revisions, acceptance, ownership) with a content hash and each
  party's acceptance timestamp. Every change is a new version.

Contracts reference users and organisations with RESTRICT: agreed terms are
records that must not disappear when an account is removed (Phase 7 account
deletion must anonymise instead).

All additive. Downgrade drops the three tables.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0053_proposals_contracts"
down_revision = "0052_invites_saved_freelancers"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def upgrade():
    tables = _tables()
    if "listing_invitations" not in tables:
        raise RuntimeError("listing_invitations does not exist. Apply 0052 first.")
    now = sa.text("CURRENT_TIMESTAMP")

    if "listing_proposals" not in tables:
        op.create_table(
            "listing_proposals",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("listing_id", sa.String(36), sa.ForeignKey("project_listings.id", ondelete="CASCADE"), nullable=False),
            sa.Column("freelancer_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("invitation_id", sa.String(36), sa.ForeignKey("listing_invitations.id", ondelete="SET NULL"), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="submitted"),
            sa.Column("cover_letter", sa.Text(), nullable=False, server_default=""),
            sa.Column("price_minor", sa.BigInteger(), nullable=False),
            sa.Column("currency", sa.String(3), nullable=False, server_default="INR"),
            sa.Column("budget_model", sa.String(20), nullable=False, server_default="fixed"),
            sa.Column("estimated_days", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint("listing_id", "freelancer_user_id", name="uq_listing_proposal"),
            sa.CheckConstraint("status IN ('submitted', 'shortlisted', 'declined', 'withdrawn', 'offered', 'hired')", name="ck_listing_proposals_status"),
            sa.CheckConstraint("price_minor > 0", name="ck_listing_proposals_price"),
            sa.CheckConstraint("budget_model IN ('fixed', 'hourly')", name="ck_listing_proposals_model"),
            sa.CheckConstraint("estimated_days IS NULL OR (estimated_days >= 1 AND estimated_days <= 730)", name="ck_listing_proposals_days"),
        )
        op.create_index("ix_listing_proposals_listing", "listing_proposals", ["listing_id", "created_at"])
        op.create_index("ix_listing_proposals_freelancer", "listing_proposals", ["freelancer_user_id", "created_at"])

    if "contracts" not in tables:
        op.create_table(
            "contracts",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("listing_id", sa.String(36), sa.ForeignKey("project_listings.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("proposal_id", sa.String(36), sa.ForeignKey("listing_proposals.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("freelancer_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="offered"),
            sa.Column("current_version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint("status IN ('offered', 'active', 'declined', 'withdrawn', 'completed', 'cancelled')", name="ck_contracts_status"),
        )
        op.create_index("ix_contracts_org", "contracts", ["organization_id", "created_at"])
        op.create_index("ix_contracts_freelancer", "contracts", ["freelancer_user_id", "created_at"])
        op.create_index(
            "uq_contracts_open_per_proposal", "contracts", ["proposal_id"], unique=True,
            postgresql_where=sa.text("status IN ('offered', 'active')"),
            sqlite_where=sa.text("status IN ('offered', 'active')"),
        )

    if "contract_versions" not in tables:
        op.create_table(
            "contract_versions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("contract_id", sa.String(36), sa.ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("title", sa.String(160), nullable=False),
            sa.Column("scope", sa.Text(), nullable=False, server_default=""),
            sa.Column("deliverables_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("milestones_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("total_minor", sa.BigInteger(), nullable=False),
            sa.Column("currency", sa.String(3), nullable=False, server_default="INR"),
            sa.Column("revision_rounds", sa.Integer(), nullable=False, server_default="2"),
            sa.Column("acceptance_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("ownership_terms", sa.Text(), nullable=False, server_default=""),
            sa.Column("content_hash", sa.String(64), nullable=False),
            sa.Column("proposed_by", sa.String(20), nullable=False),
            sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.Column("client_accepted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("client_accepted_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("freelancer_accepted_at", sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint("contract_id", "version", name="uq_contract_version"),
            sa.CheckConstraint("total_minor > 0", name="ck_contract_versions_total"),
            sa.CheckConstraint("revision_rounds >= 0 AND revision_rounds <= 10", name="ck_contract_versions_revisions"),
            sa.CheckConstraint("proposed_by IN ('client', 'freelancer')", name="ck_contract_versions_proposed_by"),
        )


def downgrade():
    tables = _tables()
    for name in ("contract_versions", "contracts", "listing_proposals"):
        if name in tables:
            op.drop_table(name)

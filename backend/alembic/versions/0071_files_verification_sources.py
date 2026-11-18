"""Listing reference files, staff verification and discovery-source management (U10).

Revision ID: 0071_files_verification_sources
Revises: 0070_discussions_interviews

``listing_files``: reference files a client attaches to a project brief
(posting wizard step 7), stored in Cloudflare R2 like contract files.

``verification_requests`` with ``profiles.verified_at`` and
``organizations.verified_at``: a freelancer or a client account asks staff to
review public evidence (work links, business website, registration number).
Staff approve or reject with a note; approval can be revoked. This is a review
of public evidence, never an identity (KYC) check.

``discovery_sources`` and ``discovery_source_runs``: staff switch each
external job source on or off with a note; every discovery run records how
each source did, so staff see failures and freshness.

Additive only. Downgrade drops the tables and the two columns.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0071_files_verification_sources"
down_revision = "0070_discussions_interviews"
branch_labels = None
depends_on = None

SOURCES = ["freelancer", "hackernews", "reddit", "remotive", "jobicy", "remoteok", "himalayas"]


def upgrade():
    bind = op.get_bind()
    insp = inspect(bind)
    tables = set(insp.get_table_names())

    if "listing_files" not in tables:
        op.create_table(
            "listing_files",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("listing_id", sa.String(36), sa.ForeignKey("project_listings.id", ondelete="CASCADE"), nullable=False),
            sa.Column("uploaded_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("r2_key", sa.String(200), nullable=False, unique=True),
            sa.Column("filename", sa.String(130), nullable=False),
            sa.Column("content_type", sa.String(120), nullable=False),
            sa.Column("size_bytes", sa.BigInteger(), nullable=False),
            sa.Column("sha256", sa.String(64), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="ready"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint("status IN ('ready', 'deleted')", name="ck_listing_files_status"),
            sa.CheckConstraint("size_bytes > 0", name="ck_listing_files_size"),
        )
        op.create_index("ix_listing_files_listing", "listing_files", ["listing_id", "status"])

    if "verification_requests" not in tables:
        op.create_table(
            "verification_requests",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("subject_type", sa.String(20), nullable=False),
            sa.Column("subject_id", sa.String(36), nullable=False),
            sa.Column("requested_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("evidence_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
            sa.Column("decided_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("decision_note", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.CheckConstraint("subject_type IN ('freelancer', 'client')", name="ck_verification_subject"),
            sa.CheckConstraint("status IN ('pending', 'approved', 'rejected', 'revoked')", name="ck_verification_status"),
        )
        op.create_index("ix_verification_status", "verification_requests", ["status", "created_at"])
        op.create_index("ix_verification_subject", "verification_requests", ["subject_type", "subject_id", "created_at"])
        op.create_index(
            "uq_verification_pending", "verification_requests", ["subject_type", "subject_id"], unique=True,
            postgresql_where=sa.text("status = 'pending'"), sqlite_where=sa.text("status = 'pending'"),
        )

    if "verified_at" not in {c["name"] for c in insp.get_columns("profiles")}:
        op.add_column("profiles", sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True))
    if "verified_at" not in {c["name"] for c in insp.get_columns("organizations")}:
        op.add_column("organizations", sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True))

    if "discovery_sources" not in tables:
        sources = op.create_table(
            "discovery_sources",
            sa.Column("code", sa.String(40), primary_key=True),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("note", sa.Text(), nullable=False, server_default=""),
            sa.Column("updated_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        )
        op.bulk_insert(sources, [{"code": code, "enabled": True, "note": ""} for code in SOURCES])

    if "discovery_source_runs" not in tables:
        op.create_table(
            "discovery_source_runs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("source", sa.String(40), nullable=False),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("fetched", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("error", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.CheckConstraint("fetched >= 0", name="ck_source_runs_fetched"),
        )
        op.create_index("ix_source_runs_source", "discovery_source_runs", ["source", "created_at"])


def downgrade():
    insp = inspect(op.get_bind())
    tables = set(insp.get_table_names())
    for name in ("discovery_source_runs", "discovery_sources", "verification_requests", "listing_files"):
        if name in tables:
            op.drop_table(name)
    for table in ("organizations", "profiles"):
        if "verified_at" in {c["name"] for c in insp.get_columns(table)}:
            op.drop_column(table, "verified_at")

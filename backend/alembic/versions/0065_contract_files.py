"""Contract file attachments stored in Cloudflare R2 (Phase 3 follow-up; K-19, K-26).

Revision ID: 0065_contract_files
Revises: 0064_org_invitations

``contract_files``: one row per uploaded file. Bytes live in the R2 bucket
bound to the Edge Worker as ``FILES``; the database keeps the key, original
name, server-detected type, size and SHA-256, the uploader and their side, and
the delivery (``submission_id``) the file was attached to. Deleting a file
removes the object and marks the row ``deleted``.

Additive. Downgrade drops the table (objects in R2 must then be removed by hand).
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0065_contract_files"
down_revision = "0064_org_invitations"
branch_labels = None
depends_on = None


def upgrade():
    if "contract_files" in set(inspect(op.get_bind()).get_table_names()):
        return
    op.create_table(
        "contract_files",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("contract_id", sa.String(36), sa.ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("uploaded_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("party", sa.String(20), nullable=False),
        sa.Column("submission_id", sa.String(36), sa.ForeignKey("milestone_submissions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("r2_key", sa.String(200), nullable=False),
        sa.Column("filename", sa.String(160), nullable=False),
        sa.Column("content_type", sa.String(120), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="ready"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("party IN ('client', 'freelancer')", name="ck_contract_files_party"),
        sa.CheckConstraint("status IN ('ready', 'deleted')", name="ck_contract_files_status"),
        sa.CheckConstraint("size_bytes > 0", name="ck_contract_files_size"),
        sa.UniqueConstraint("r2_key", name="uq_contract_files_key"),
    )
    op.create_index("ix_contract_files_contract", "contract_files", ["contract_id", "created_at"])
    op.create_index("ix_contract_files_submission", "contract_files", ["submission_id"])


def downgrade():
    if "contract_files" in set(inspect(op.get_bind()).get_table_names()):
        op.drop_table("contract_files")

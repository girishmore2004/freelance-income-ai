"""Add immutable post-closeout archive manifests and retention review workflow."""
from alembic import op
import sqlalchemy as sa

revision = "0042_archive_retention"
down_revision = "0041_closeout_signoff"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "delivery_archive_manifests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("manifest_json", sa.Text(), nullable=False),
        sa.Column("manifest_hash", sa.String(64), nullable=False),
        sa.Column("created_by", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "project_id", "version", name="uq_archive_manifest_version"),
    )
    for col in ("user_id", "project_id"):
        op.create_index(f"ix_delivery_archive_manifests_{col}", "delivery_archive_manifests", [col])

    op.create_table(
        "project_retention_policies",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("retention_days", sa.Integer(), nullable=False, server_default="365"),
        sa.Column("approved_by", sa.String(36), nullable=False, server_default=""),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_project_retention_policies_user_id", "project_retention_policies", ["user_id"])

    op.create_table(
        "project_retention_reviews",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("proposed_days", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("requested_by", sa.String(36), nullable=False),
        sa.Column("decided_by", sa.String(36), nullable=False, server_default=""),
        sa.Column("decision_note", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_project_retention_reviews_user_id", "project_retention_reviews", ["user_id"])


def downgrade():
    op.drop_index("ix_project_retention_reviews_user_id", table_name="project_retention_reviews")
    op.drop_table("project_retention_reviews")
    op.drop_index("ix_project_retention_policies_user_id", table_name="project_retention_policies")
    op.drop_table("project_retention_policies")
    op.drop_index("ix_delivery_archive_manifests_project_id", table_name="delivery_archive_manifests")
    op.drop_index("ix_delivery_archive_manifests_user_id", table_name="delivery_archive_manifests")
    op.drop_table("delivery_archive_manifests")

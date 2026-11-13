"""Create immutable delivery handover snapshots."""
from alembic import op
import sqlalchemy as sa

revision = "0040_delivery_handover_snapshots"
down_revision = "0039_delivery_issue_root_cause"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "delivery_handover_snapshots",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", sa.String(length=36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("snapshot_json", sa.Text(), nullable=False),
        sa.Column("snapshot_hash", sa.String(length=64), nullable=False),
        sa.Column("input_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="draft"),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by", sa.String(length=36), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "project_id", "version", name="uq_handover_snapshot_version"),
    )
    op.create_index("ix_delivery_handover_snapshots_user_id", "delivery_handover_snapshots", ["user_id"])
    op.create_index("ix_delivery_handover_snapshots_project_id", "delivery_handover_snapshots", ["project_id"])


def downgrade():
    op.drop_index("ix_delivery_handover_snapshots_project_id", table_name="delivery_handover_snapshots")
    op.drop_index("ix_delivery_handover_snapshots_user_id", table_name="delivery_handover_snapshots")
    op.drop_table("delivery_handover_snapshots")

"""Add archive supersession and recovery rehearsal records."""
from alembic import op
import sqlalchemy as sa

revision = "0043_archive_supersession"
down_revision = "0042_archive_retention"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "archive_supersession_records",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("superseded_manifest_id", sa.String(36), sa.ForeignKey("delivery_archive_manifests.id", ondelete="RESTRICT"), nullable=False, unique=True),
        sa.Column("replacement_manifest_id", sa.String(36), sa.ForeignKey("delivery_archive_manifests.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_by", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    for col in ("user_id", "project_id", "replacement_manifest_id"):
        op.create_index(f"ix_archive_supersession_records_{col}", "archive_supersession_records", [col])

    op.create_table(
        "project_recovery_rehearsals",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("archive_manifest_id", sa.String(36), sa.ForeignKey("delivery_archive_manifests.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("overall_status", sa.String(24), nullable=False),
        sa.Column("checklist_json", sa.Text(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("performed_by", sa.String(36), nullable=False),
        sa.Column("performed_at", sa.DateTime(timezone=True), nullable=False),
    )
    for col in ("user_id", "project_id", "archive_manifest_id"):
        op.create_index(f"ix_project_recovery_rehearsals_{col}", "project_recovery_rehearsals", [col])


def downgrade():
    for col in ("archive_manifest_id", "project_id", "user_id"):
        op.drop_index(f"ix_project_recovery_rehearsals_{col}", table_name="project_recovery_rehearsals")
    op.drop_table("project_recovery_rehearsals")
    for col in ("replacement_manifest_id", "project_id", "user_id"):
        op.drop_index(f"ix_archive_supersession_records_{col}", table_name="archive_supersession_records")
    op.drop_table("archive_supersession_records")

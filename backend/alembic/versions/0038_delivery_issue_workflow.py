"""Add evidence-linked delivery issue and corrective-action workflow."""
from alembic import op
import sqlalchemy as sa

revision = "0038_delivery_issue_workflow"
down_revision = "0037_delivery_audit_hash_chain"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "delivery_issues",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", sa.String(length=36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("deliverable_id", sa.String(length=36), sa.ForeignKey("project_deliverables.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("revision_id", sa.String(length=36), sa.ForeignKey("deliverable_revisions.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("feedback_event_id", sa.String(length=36), sa.ForeignKey("deliverable_acceptance_events.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("severity", sa.String(length=20), nullable=False, server_default="medium"),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="open"),
        sa.Column("assigned_to", sa.String(length=160), nullable=False, server_default=""),
        sa.Column("corrective_action", sa.Text(), nullable=False, server_default=""),
        sa.Column("due_date", sa.String(length=10), nullable=False, server_default=""),
        sa.Column("resolution_note", sa.Text(), nullable=False, server_default=""),
        sa.Column("resolution_evidence_reference", sa.Text(), nullable=False, server_default=""),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    for name, cols in [
        ("ix_delivery_issues_user_id", ["user_id"]),
        ("ix_delivery_issues_project_id", ["project_id"]),
        ("ix_delivery_issues_deliverable_id", ["deliverable_id"]),
        ("ix_delivery_issues_revision_id", ["revision_id"]),
        ("ix_delivery_issues_feedback_event_id", ["feedback_event_id"]),
        ("ix_delivery_issues_user_project_status", ["user_id", "project_id", "status"]),
    ]:
        op.create_index(name, "delivery_issues", cols)


def downgrade():
    for name in ["ix_delivery_issues_user_project_status", "ix_delivery_issues_feedback_event_id",
                 "ix_delivery_issues_revision_id", "ix_delivery_issues_deliverable_id",
                 "ix_delivery_issues_project_id", "ix_delivery_issues_user_id"]:
        op.drop_index(name, table_name="delivery_issues")
    op.drop_table("delivery_issues")

"""Add explicit origin classification to deliverable revisions."""
from alembic import op
import sqlalchemy as sa

revision = "0035_deliverable_revision_origin"
down_revision = "0034_task_completion_tracking"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("deliverable_revisions", sa.Column("revision_origin", sa.String(length=40), nullable=False, server_default="unclassified"))
    op.add_column("deliverable_revisions", sa.Column("origin_note", sa.Text(), nullable=False, server_default=""))
    op.add_column("deliverable_revisions", sa.Column("origin_evidence_reference", sa.Text(), nullable=False, server_default=""))
    # Historical records cannot safely be classified from revision timing or notes.
    op.execute("UPDATE deliverable_revisions SET revision_origin = 'unclassified' WHERE version > 1")
    op.execute("UPDATE deliverable_revisions SET revision_origin = 'initial' WHERE version = 1")


def downgrade():
    op.drop_column("deliverable_revisions", "origin_evidence_reference")
    op.drop_column("deliverable_revisions", "origin_note")
    op.drop_column("deliverable_revisions", "revision_origin")

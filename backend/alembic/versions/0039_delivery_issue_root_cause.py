"""Add explicit delivery issue root-cause classification."""
from alembic import op
import sqlalchemy as sa

revision = "0039_delivery_issue_root_cause"
down_revision = "0038_delivery_issue_workflow"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("delivery_issues", sa.Column("root_cause", sa.String(length=40), nullable=False, server_default="unclassified"))


def downgrade():
    op.drop_column("delivery_issues", "root_cause")

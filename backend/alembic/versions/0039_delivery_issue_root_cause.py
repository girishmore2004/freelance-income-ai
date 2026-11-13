
"""Add explicit delivery issue root-cause classification."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0039_delivery_issue_root_cause"
down_revision = "0038_delivery_issue_workflow"
branch_labels = None
depends_on = None


def upgrade():
    inspector = inspect(op.get_bind())

    if "delivery_issues" not in inspector.get_table_names():
        raise RuntimeError(
            "Required table 'delivery_issues' does not exist."
        )

    columns = {
        column["name"]
        for column in inspector.get_columns("delivery_issues")
    }

    if "root_cause" not in columns:
        op.add_column(
            "delivery_issues",
            sa.Column(
                "root_cause",
                sa.String(length=40),
                nullable=False,
                server_default="unclassified",
            ),
        )


def downgrade():
    # Preserve issue root-cause classifications.
    pass

"""Add project-to-opportunity attribution for source revenue analytics.

Revision ID: 0016_project_opportunity_attribution
Revises: 0015_delivery_finance
"""
from alembic import op
import sqlalchemy as sa

revision = "0016_project_opportunity_attribution"
down_revision = "0015_delivery_finance"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("projects") as batch_op:
        batch_op.add_column(sa.Column(
            "origin_opportunity_id", sa.String(36),
            sa.ForeignKey("opportunities.id", ondelete="SET NULL", name="fk_projects_origin_opportunity"),
            nullable=True,
        ))
    op.create_index("ix_projects_origin_opportunity_id", "projects", ["origin_opportunity_id"])


def downgrade():
    op.drop_index("ix_projects_origin_opportunity_id", table_name="projects")
    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_column("origin_opportunity_id")

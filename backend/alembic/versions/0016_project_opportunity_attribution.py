"""Add project-to-opportunity attribution.

Revision ID: 0016_project_opportunity_attribution
Revises: 0015_delivery_finance

The initial schema migration may already have created this column and
index from current SQLAlchemy metadata. Check the live schema before
creating either object.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0016_proj_opp_attr"
down_revision = "0015_delivery_finance"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)

    if "projects" not in inspector.get_table_names():
        raise RuntimeError(
            "Cannot apply project attribution migration: "
            "projects table does not exist."
        )

    columns = {
        column["name"]
        for column in inspector.get_columns("projects")
    }

    if "origin_opportunity_id" not in columns:
        with op.batch_alter_table("projects") as batch_op:
            batch_op.add_column(
                sa.Column(
                    "origin_opportunity_id",
                    sa.String(36),
                    sa.ForeignKey(
                        "opportunities.id",
                        ondelete="SET NULL",
                        name="fk_projects_origin_opportunity",
                    ),
                    nullable=True,
                )
            )

    inspector = inspect(bind)
    indexes = {
        index["name"]
        for index in inspector.get_indexes("projects")
    }

    if "ix_projects_origin_opportunity_id" not in indexes:
        op.create_index(
            "ix_projects_origin_opportunity_id",
            "projects",
            ["origin_opportunity_id"],
        )


def downgrade():
    bind = op.get_bind()
    inspector = inspect(bind)

    if "projects" not in inspector.get_table_names():
        return

    indexes = {
        index["name"]
        for index in inspector.get_indexes("projects")
    }

    if "ix_projects_origin_opportunity_id" in indexes:
        op.drop_index(
            "ix_projects_origin_opportunity_id",
            table_name="projects",
        )

    columns = {
        column["name"]
        for column in inspect(bind).get_columns("projects")
    }

    if "origin_opportunity_id" in columns:
        with op.batch_alter_table("projects") as batch_op:
            batch_op.drop_column("origin_opportunity_id")

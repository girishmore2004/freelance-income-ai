
"""Add explicit origin classification to deliverable revisions."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0035_deliverable_revision_origin"
down_revision = "0034_task_completion_tracking"
branch_labels = None
depends_on = None


TABLE = "deliverable_revisions"

NEW_COLUMNS = (
    sa.Column(
        "revision_origin",
        sa.String(length=40),
        nullable=False,
        server_default="unclassified",
    ),
    sa.Column(
        "origin_note",
        sa.Text(),
        nullable=False,
        server_default="",
    ),
    sa.Column(
        "origin_evidence_reference",
        sa.Text(),
        nullable=False,
        server_default="",
    ),
)


def _columns():
    inspector = inspect(op.get_bind())

    if TABLE not in inspector.get_table_names():
        raise RuntimeError(f"Required table {TABLE!r} does not exist.")

    return {
        column["name"]
        for column in inspector.get_columns(TABLE)
    }


def upgrade():
    existing = _columns()

    for column in NEW_COLUMNS:
        if column.name not in existing:
            op.add_column(TABLE, column)

    # Preserve the original historical classification policy.
    # Version 1 is the initial revision; later historical revisions cannot
    # safely be classified as client-requested or scope-change revisions.
    op.execute(
        sa.text(
            """
            UPDATE deliverable_revisions
            SET revision_origin = 'unclassified'
            WHERE version > 1
              AND (
                  revision_origin IS NULL
                  OR revision_origin = ''
                  OR revision_origin = 'unclassified'
              )
            """
        )
    )

    op.execute(
        sa.text(
            """
            UPDATE deliverable_revisions
            SET revision_origin = 'initial'
            WHERE version = 1
              AND (
                  revision_origin IS NULL
                  OR revision_origin = ''
                  OR revision_origin = 'unclassified'
              )
            """
        )
    )


def downgrade():
    # Preserve revision-origin audit data. These columns may have been
    # created by the initial metadata baseline.
    pass

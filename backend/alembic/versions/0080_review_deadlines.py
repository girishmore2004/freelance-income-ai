"""Deadlines when someone stops answering (U29, founder decisions 2026-11-20).

Revision ID: 0080_review_deadlines
Revises: 0079_agents_complete

Additive:
- ``milestone_submissions.review_extensions`` (SMALLINT, default 0): how many
  times the client extended the review of a service-order delivery (5 days
  each, at most 2). Service-order deliveries complete automatically 3 days
  after delivery plus any extension; fixed-price project milestones keep no
  deadline (D-25).

The other new rules need no schema: late milestones are computed from the
agreed due dates, the 48-hour cancellation reply deadline from
``contract_cancellations.created_at`` and the 7-day dispute reply deadline from
``disputes.created_at`` and ``dispute_statements``.

Downgrade drops the column.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0080_review_deadlines"
down_revision = "0079_agents_complete"
branch_labels = None
depends_on = None


def upgrade():
    insp = inspect(op.get_bind())
    if "milestone_submissions" in set(insp.get_table_names()):
        cols = {c["name"] for c in insp.get_columns("milestone_submissions")}
        if "review_extensions" not in cols:
            op.add_column(
                "milestone_submissions",
                sa.Column("review_extensions", sa.SmallInteger(), nullable=False, server_default="0"),
            )


def downgrade():
    insp = inspect(op.get_bind())
    if "milestone_submissions" in set(insp.get_table_names()):
        cols = {c["name"] for c in insp.get_columns("milestone_submissions")}
        if "review_extensions" in cols:
            op.drop_column("milestone_submissions", "review_extensions")

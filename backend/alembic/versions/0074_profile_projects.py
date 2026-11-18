"""Profile projects and the F3 Profile Coach (U17).

Revision ID: 0074_profile_projects
Revises: 0073_saved_searches

``profiles.portfolio_items_json``: the freelancer's own project list (title,
what they did, skills, optional link, year), entered by hand or confirmed from
a resume import. The resume file itself is never stored.

Registry: F3 Profile and Portfolio Coach becomes ``partial`` with runtime name
``profile_coach`` (resume extraction; the person confirms every fact). Rows an
admin already changed away from ``planned`` are left alone.

Additive. Downgrade drops the column and restores F3 to ``planned``.
"""

import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0074_profile_projects"
down_revision = "0073_saved_searches"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if "portfolio_items_json" not in {c["name"] for c in inspect(bind).get_columns("profiles")}:
        op.add_column("profiles", sa.Column("portfolio_items_json", sa.Text(), nullable=False, server_default="[]"))
    if "agent_definitions" in inspect(bind).get_table_names():
        bind.execute(
            sa.text(
                "UPDATE agent_definitions SET status = 'partial', runtime_names_json = :names, updated_at = CURRENT_TIMESTAMP "
                "WHERE code = 'F3' AND status = 'planned'"
            ),
            {"names": json.dumps(["profile_coach"])},
        )


def downgrade():
    bind = op.get_bind()
    if "portfolio_items_json" in {c["name"] for c in inspect(bind).get_columns("profiles")}:
        op.drop_column("profiles", "portfolio_items_json")
    if "agent_definitions" in inspect(bind).get_table_names():
        bind.execute(sa.text("UPDATE agent_definitions SET status = 'planned', runtime_names_json = '[]', updated_at = CURRENT_TIMESTAMP WHERE code = 'F3' AND status = 'partial'"))

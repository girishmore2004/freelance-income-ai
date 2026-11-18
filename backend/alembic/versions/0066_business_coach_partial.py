"""Registry update: F11 Business Coach runs on the Edge API (K-01 port).

Revision ID: 0066_business_coach_partial
Revises: 0065_contract_files

Data-only. F11 answers questions from the account's own records with
citations, through the AI governor (operation ``business_coach``). It is
``partial`` because the portfolio-document retrieval of the Python coach is
not ported. Rows an admin already changed away from ``planned`` are left
alone. Downgrade restores ``planned``.
"""

import json

from alembic import op
import sqlalchemy as sa


revision = "0066_business_coach_partial"
down_revision = "0065_contract_files"
branch_labels = None
depends_on = None

PARTIAL = {"F11": ["business_coach"]}


def upgrade():
    bind = op.get_bind()
    for code, names in PARTIAL.items():
        bind.execute(
            sa.text(
                "UPDATE agent_definitions SET status = 'partial', runtime_names_json = :names, updated_at = CURRENT_TIMESTAMP "
                "WHERE code = :code AND status = 'planned'"
            ),
            {"code": code, "names": json.dumps(names)},
        )


def downgrade():
    bind = op.get_bind()
    for code in PARTIAL:
        bind.execute(
            sa.text("UPDATE agent_definitions SET status = 'planned', runtime_names_json = '[]', updated_at = CURRENT_TIMESTAMP WHERE code = :code AND status = 'partial'"),
            {"code": code},
        )

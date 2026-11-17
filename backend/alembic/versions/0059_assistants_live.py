"""Registry update: C3, C5 and C6 assistants are built (Phase 6).

Revision ID: 0059_assistants_live
Revises: 0058_agent_registry

Data-only. Marks the deterministic client assistants as live and records the
names they write to ``agent_runs``. Rows an admin already changed away from
``planned`` are left alone. Downgrade restores ``planned``.
"""

import json

from alembic import op
import sqlalchemy as sa


revision = "0059_assistants_live"
down_revision = "0058_agent_registry"
branch_labels = None
depends_on = None

LIVE = {
    "C3": ["proposal_comparison"],
    "C5": ["contract_assistant"],
    "C6": ["acceptance_assistant"],
}


def upgrade():
    bind = op.get_bind()
    for code, names in LIVE.items():
        bind.execute(
            sa.text(
                "UPDATE agent_definitions SET status = 'live', runtime_names_json = :names, updated_at = CURRENT_TIMESTAMP "
                "WHERE code = :code AND status = 'planned'"
            ),
            {"code": code, "names": json.dumps(names)},
        )


def downgrade():
    bind = op.get_bind()
    for code in LIVE:
        bind.execute(
            sa.text("UPDATE agent_definitions SET status = 'planned', runtime_names_json = '[]', updated_at = CURRENT_TIMESTAMP WHERE code = :code AND status = 'live'"),
            {"code": code},
        )

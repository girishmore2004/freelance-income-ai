"""Registry update: agents built since 0058 get an honest status (U20).

Revision ID: 0077_agent_registry_refresh
Revises: 0076_hourly_contracts

Data-only. Rules-based agents with their own endpoint become ``live``:
F5 Pricing and Scope (advisory range), F8 Delivery QA (pre-delivery check),
C4 Interview Preparation (questions from brief and proposal), P3 Dispute
Assistant (evidence pack and timeline, no model). Agents whose work is partly
done in existing features become ``partial``: F7 Delivery Planner (task plan
and timeline), C7 Spend and Outcomes (client analytics, statements, hire
again), P5 Source Compliance (source health and switches), P7 Marketplace
Balance (category health in platform analytics), P9 Notification Orchestrator
(deduplicated notifications, weekly and daily digests, per-side counts).
Only rows still ``planned`` change, so an admin's own changes are kept.
Downgrade returns exactly these rows to ``planned``.
"""

import json

from alembic import op
import sqlalchemy as sa


revision = "0077_agent_registry_refresh"
down_revision = "0076_hourly_contracts"
branch_labels = None
depends_on = None

LIVE = {"F5": ["pricing_advice"], "F8": ["delivery_qa"], "C4": ["interview_prep"], "P3": ["dispute_evidence"]}
PARTIAL = {"F7": ["task_plan"], "C7": ["client_insights"], "P5": ["source_health"], "P7": ["category_health"], "P9": ["notifications"]}


def upgrade():
    bind = op.get_bind()
    for status, group in (("live", LIVE), ("partial", PARTIAL)):
        for code, names in group.items():
            bind.execute(
                sa.text(
                    "UPDATE agent_definitions SET status = :status, runtime_names_json = :names, updated_at = CURRENT_TIMESTAMP "
                    "WHERE code = :code AND status = 'planned'"
                ),
                {"code": code, "names": json.dumps(names), "status": status},
            )


def downgrade():
    bind = op.get_bind()
    for status, group in (("live", LIVE), ("partial", PARTIAL)):
        for code, names in group.items():
            bind.execute(
                sa.text(
                    "UPDATE agent_definitions SET status = 'planned', runtime_names_json = '[]', updated_at = CURRENT_TIMESTAMP "
                    "WHERE code = :code AND status = :status AND runtime_names_json = :names"
                ),
                {"code": code, "names": json.dumps(names), "status": status},
            )

"""Governed agent registry (Phase 6).

Revision ID: 0058_agent_registry
Revises: 0057_plans_credits

``agent_definitions`` records every agent in the Master Plan v2 catalogue
(sections 3.6–3.8) with its purpose, autonomy ceiling, human gate, tools and
limits, the runtime names it writes to ``agent_runs``, its honest build
status on the Edge API, and an ``enabled`` switch. Disabling an AI-using agent
makes the AI governor refuse its model calls, so the deterministic fallback is
used instead.

Note: the plan's text says "27 agents"; its catalogue tables list 28
(F1–F12, C1–C7, P1–P9). All 28 are recorded.

Additive + seed (existing rows are left untouched on re-run).
"""

import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0058_agent_registry"
down_revision = "0057_plans_credits"
branch_labels = None
depends_on = None

# (code, name, side, purpose, ceiling, human_gate, tools, status, runtime_names)
AGENTS = [
    ("F1", "Opportunity Scout", "freelancer", "Finds relevant external and native projects, de-duplicates, expires stale items, explains why each matters.", "A3", "None for refresh; user chooses to apply", ["source_fetch:R", "classify:D", "save:W1"], "partial", ["discovery_agent"]),
    ("F2", "Fit and Risk Analyst", "freelancer", "100-point transparent match score with reasons, gaps and risk signals.", "A1", "User decides", ["retrieve:R", "score:R"], "live", ["matching_agent"]),
    ("F3", "Profile and Portfolio Coach", "freelancer", "Extracts skills from a resume, proposes profile text, flags weak or unsupported claims.", "A2", "User confirms every extracted fact", ["extract:R", "draft:D"], "planned", []),
    ("F4", "Proposal Agent", "freelancer", "Drafts proposals from confirmed evidence, flags unsupported claims, checks price consistency.", "A2", "Hash-bound approval before submission", ["retrieve:R", "draft:D", "quality_check:R"], "live", ["proposal_agent", "apply_agent"]),
    ("F5", "Pricing and Scope Agent", "freelancer", "Advisory price from rate, effort and past wins; lists assumptions and exclusions.", "A1", "Parties agree the price", ["pricing_model:R", "draft:D"], "planned", []),
    ("F6", "Clarification Assistant", "freelancer", "Suggests questions, prepares interview notes, summarises discussions with consent.", "A2", "User conducts and decides", ["read_thread:R", "draft:D"], "planned", []),
    ("F7", "Delivery Planner", "freelancer", "Dependency graph, critical path, capacity-aware schedule, deadline-risk alerts.", "A2", "Owner approves plan versions", ["schedule:R", "schedule:D", "task:W1"], "planned", []),
    ("F8", "Delivery QA Agent", "freelancer", "Checks work in progress against acceptance criteria before submission.", "A1", "Freelancer submits", ["read_criteria:R", "checklist:D"], "planned", []),
    ("F9", "Inbox Agent", "freelancer", "Classifies client replies, scores urgency, suggests follow-ups.", "A2", "Approval before send", ["mail_read:R", "draft:D", "reminder:W1"], "partial", ["reply_agent"]),
    ("F10", "Finance and Cash-Flow Agent", "freelancer", "Explains invoices and outstanding amounts, forecasts cash flow, drafts payment reminders.", "A2", "Human sends reminders; no transfers", ["invoice:R", "forecast:R", "reminder:D"], "blocked", []),
    ("F11", "Business Coach", "freelancer", "Source ROI, win rate, pricing outcomes, capacity advice, next actions.", "A1", "User decides", ["analytics:R"], "planned", []),
    ("F12", "Reputation Builder", "freelancer", "Turns completed, consented projects into case studies and review requests.", "A2", "Freelancer and client permission", ["contract:R", "draft:D"], "planned", []),
    ("C1", "Brief Builder", "client", "Turns an informal description into a structured brief and asks for missing information.", "A2", "Client confirms the final brief", ["draft:D", "category_template:R"], "live", ["brief_builder"]),
    ("C2", "Match and Shortlist Agent", "client", "Finds and explains candidate freelancers; newcomer exposure.", "A1", "Client invites or decides", ["match:R", "capacity:R"], "live", ["match_shortlist"]),
    ("C3", "Proposal Comparison Agent", "client", "Side-by-side comparison of price, timeline, deliverables and assumptions; never ranks by price alone.", "A1", "Client shortlists and decides", ["read_proposals:R", "compare:D"], "planned", []),
    ("C4", "Interview Preparation Agent", "client", "Suggests questions, flags missing scope, summarises discussions with consent.", "A2", "Client conducts", ["read_thread:R", "draft:D"], "planned", []),
    ("C5", "Contract and Milestone Assistant", "client", "Drafts milestones, acceptance criteria, revision rules and exclusions; flags missing terms.", "A2", "Both parties accept the same version", ["template:R", "draft:D"], "planned", []),
    ("C6", "Review and Acceptance Assistant", "client", "Compares a submission with the agreed acceptance criteria; classifies feedback as revision or scope change.", "A1", "Client accepts or requests revision", ["read_deliverable:R", "compare:D"], "planned", []),
    ("C7", "Spend and Outcomes Insights", "client", "Project spend, cycle times, repeat-hire suggestions, budget forecasts.", "A1", "Client decides", ["analytics:R"], "planned", []),
    ("P1", "Trust and Safety Agent", "platform", "Flags suspicious listings, messages and behaviour; routes uncertain cases to a human.", "A1", "Human moderator decides", ["signals:R", "case:D"], "partial", []),
    ("P2", "Payment Risk Agent", "platform", "Recommends client payment tier and exposure cap from evidence.", "A1", "Finance approves policy", ["payment_history:R", "recommend:D"], "blocked", []),
    ("P3", "Dispute Assistant", "platform", "Assembles evidence pack and neutral timeline; suggests outcomes.", "A1", "Human reviewer decides", ["contract:R", "messages:R", "pack:D"], "planned", []),
    ("P4", "Support Agent", "platform", "Answers help questions from policy documents; drafts replies.", "A2", "Staff approve sensitive replies", ["knowledge_base:R", "draft:D"], "planned", []),
    ("P5", "Source Compliance Agent", "platform", "Checks source registry fields, freshness and takedown requests.", "A3", "Human reviews", ["registry:R", "disable_source:W1"], "planned", []),
    ("P6", "Reconciliation Agent", "platform", "Compares invoices, collections, fees, refunds, payouts and provider balances.", "A1", "Finance resolves", ["ledger:R", "provider_reports:R"], "blocked", []),
    ("P7", "Marketplace Balance and Growth Agent", "platform", "Category-level supply and demand health; outreach recommendations.", "A1", "Founder decides", ["metrics:R"], "planned", []),
    ("P8", "Quality and Evaluation Agent", "platform", "Runs evaluation sets; tracks unsupported claims, drift, cost per agent, injection results.", "A1", "Engineering reviews", ["eval_sets:R"], "partial", []),
    ("P9", "Notification Orchestrator", "platform", "Batches and schedules notifications; respects quiet hours and consent.", "A3", "Preferences set by user", ["notify:W1"], "planned", []),
]


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def upgrade():
    tables = _tables()
    if "plans" not in tables:
        raise RuntimeError("plans does not exist. Apply 0057 first.")
    now = sa.text("CURRENT_TIMESTAMP")
    if "agent_definitions" not in tables:
        op.create_table(
            "agent_definitions",
            sa.Column("code", sa.String(4), primary_key=True),
            sa.Column("name", sa.String(80), nullable=False),
            sa.Column("side", sa.String(20), nullable=False),
            sa.Column("purpose", sa.String(400), nullable=False),
            sa.Column("autonomy_ceiling", sa.String(2), nullable=False),
            sa.Column("human_gate", sa.String(200), nullable=False),
            sa.Column("tools_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("runtime_names_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("status", sa.String(20), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("updated_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.CheckConstraint("side IN ('freelancer', 'client', 'platform')", name="ck_agent_definitions_side"),
            sa.CheckConstraint("autonomy_ceiling IN ('A0', 'A1', 'A2', 'A3', 'A4')", name="ck_agent_definitions_ceiling"),
            sa.CheckConstraint("status IN ('live', 'partial', 'planned', 'blocked')", name="ck_agent_definitions_status"),
        )
    bind = op.get_bind()
    for code, name, side, purpose, ceiling, gate, tools, status, runtime in AGENTS:
        if bind.execute(sa.text("SELECT 1 FROM agent_definitions WHERE code = :code"), {"code": code}).first():
            continue
        bind.execute(
            sa.text(
                "INSERT INTO agent_definitions (code, name, side, purpose, autonomy_ceiling, human_gate, tools_json, runtime_names_json, status, enabled, created_at, updated_at) "
                "VALUES (:code, :name, :side, :purpose, :ceiling, :gate, :tools, :runtime, :status, :enabled, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {
                "code": code, "name": name, "side": side, "purpose": purpose, "ceiling": ceiling, "gate": gate,
                "tools": json.dumps(tools), "runtime": json.dumps(runtime), "status": status, "enabled": True,
            },
        )
    if "agent_runs" in tables:
        indexes = {i["name"] for i in inspect(bind).get_indexes("agent_runs")}
        if "ix_agent_runs_user_created" not in indexes:
            op.create_index("ix_agent_runs_user_created", "agent_runs", ["user_id", "created_at"])


def downgrade():
    tables = _tables()
    if "agent_runs" in tables and "ix_agent_runs_user_created" in {i["name"] for i in inspect(op.get_bind()).get_indexes("agent_runs")}:
        op.drop_index("ix_agent_runs_user_created", table_name="agent_runs")
    if "agent_definitions" in tables:
        op.drop_table("agent_definitions")

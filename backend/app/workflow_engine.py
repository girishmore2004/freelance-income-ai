"""LangGraph workflow with SQL-backed, per-node checkpoints.

The SQL checkpoint rows make each completed agent stage recoverable after a worker
restart. Human approval is a durable pause represented by WorkflowRun.status.
"""
import asyncio
import json
from datetime import datetime, timezone
from typing import Any, TypedDict
from langgraph.graph import StateGraph, START, END
from sqlalchemy import select, func
from .database import SessionLocal
from .models import WorkflowRun, WorkflowCheckpoint, Opportunity, Proposal, Approval, ClientResearch, AgentRun, User
from .main_helpers import profile_dict
from .agents import proposal_agent, proposal_fingerprint
from .agents.specialists import matching_agent, research_agent, pricing_agent


class FreelanceWorkflowState(TypedDict, total=False):
    run_id: str
    user_id: str
    opportunity_id: str
    profile: dict[str, Any]
    opportunity: dict[str, Any]
    evidence: list[dict[str, Any]]
    estimated_hours: float
    proposed_price: float | None
    currency: str
    match_score: int
    score_breakdown: dict[str, Any]
    research_summary: dict[str, Any]
    pricing_advice: dict[str, Any]
    proposal_id: str
    proposal_mode: str


def _json_safe(value):
    return json.loads(json.dumps(value, default=str))


def _save_checkpoint(state: FreelanceWorkflowState, node_name: str, updates: dict[str, Any]):
    merged = dict(state)
    merged.update(updates)
    safe_state = _json_safe(merged)
    db = SessionLocal()
    try:
        run = db.scalar(select(WorkflowRun).where(
            WorkflowRun.id == state["run_id"],
            WorkflowRun.user_id == state["user_id"],
        ))
        if not run:
            raise ValueError("Workflow run no longer exists")
        sequence = (db.scalar(select(func.max(WorkflowCheckpoint.sequence)).where(
            WorkflowCheckpoint.workflow_id == run.id
        )) or 0) + 1
        run.current_step = node_name
        if "proposed_price" in updates:
            run.proposed_price = updates["proposed_price"]
        if "currency" in updates:
            run.currency = updates["currency"]
        run.state_json = json.dumps(safe_state)
        run.updated_at = datetime.now(timezone.utc)
        db.add(WorkflowCheckpoint(
            workflow_id=run.id,
            sequence=sequence,
            node_name=node_name,
            state_json=json.dumps(safe_state),
        ))
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return updates


def _matching_node(state):
    if "match_score" in state and "score_breakdown" in state:
        return {}
    result = matching_agent(state.get("profile", {}), state.get("opportunity", {}))
    return _save_checkpoint(state, "matching", {
        "match_score": result["score"],
        "score_breakdown": result["breakdown"],
    })


def _research_node(state):
    if "research_summary" in state:
        return {}
    result = research_agent(state.get("evidence", []))
    result["verification_note"] = (
        "Counts saved confidence labels and evidence URLs only; this workflow does not independently verify clients or sources."
    )
    return _save_checkpoint(state, "research", {"research_summary": result})


def _pricing_node(state):
    if "pricing_advice" in state:
        return {}
    profile = state.get("profile", {})
    opportunity = state.get("opportunity", {})
    hours = max(0.5, float(state.get("estimated_hours") or 8.0))
    hourly = max(0.0, float(profile.get("hourly_rate") or 0.0))
    minimum = max(0.0, float(profile.get("minimum_budget") or 0.0))
    floor = round(max(minimum, hourly * hours), 2) if hourly or minimum else None
    result = pricing_agent(opportunity, hours, hourly_floor=hourly)
    result["profile_floor_estimate"] = floor
    result["disclaimer"] = "Advisory estimate only; verify scope, platform fees, taxes and delivery effort."
    return _save_checkpoint(state, "pricing", {
        "pricing_advice": result,
        "proposed_price": state.get("proposed_price") if state.get("proposed_price") is not None else floor,
        "currency": state.get("currency") or opportunity.get("currency") or "INR",
    })


def _proposal_node(state):
    db = SessionLocal()
    try:
        run = db.get(WorkflowRun, state["run_id"])
        if not run:
            raise ValueError("Workflow run no longer exists")
        # Idempotency: a retried RQ task must not create a second proposal.
        if run.proposal_id:
            return {"proposal_id": run.proposal_id, "proposal_mode": "existing"}
        profile = state.get("profile", {})
        opportunity = state.get("opportunity", {})
        price = state.get("proposed_price")
        content, mode = asyncio.run(proposal_agent(profile, opportunity, price))
        proposal = Proposal(
            user_id=run.user_id,
            opportunity_id=run.opportunity_id,
            content=content,
            proposed_price=price,
            currency=state.get("currency") or opportunity.get("currency") or "INR",
            status="pending_approval",
        )
        db.add(proposal)
        db.flush()
        approval = Approval(
            user_id=run.user_id,
            proposal_id=proposal.id,
            proposal_hash=proposal_fingerprint(proposal),
            decision="pending",
        )
        db.add(approval)
        db.flush()
        updates = {"proposal_id": proposal.id, "proposal_mode": mode}
        merged = dict(state)
        merged.update(updates)
        merged_safe = _json_safe(merged)
        sequence = (db.scalar(select(func.max(WorkflowCheckpoint.sequence)).where(
            WorkflowCheckpoint.workflow_id == run.id
        )) or 0) + 1
        db.add(WorkflowCheckpoint(
            workflow_id=run.id,
            sequence=sequence,
            node_name="proposal",
            state_json=json.dumps(merged_safe),
        ))
        run.proposal_id = proposal.id
        run.approval_id = approval.id
        run.status = "awaiting_approval"
        run.current_step = "awaiting_human_approval"
        run.state_json = json.dumps(merged_safe)
        run.updated_at = datetime.now(timezone.utc)
        db.add(AgentRun(
            user_id=run.user_id,
            agent_name="workflow_orchestrator",
            summary=f"Workflow {run.id} completed analysis and paused for human approval (proposal mode: {mode}).",
        ))
        db.commit()
        return updates
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def build_freelance_workflow():
    graph = StateGraph(FreelanceWorkflowState)
    graph.add_node("matching", _matching_node)
    graph.add_node("research", _research_node)
    graph.add_node("pricing", _pricing_node)
    graph.add_node("proposal", _proposal_node)
    graph.add_edge(START, "matching")
    graph.add_edge("matching", "research")
    graph.add_edge("research", "pricing")
    graph.add_edge("pricing", "proposal")
    graph.add_edge("proposal", END)
    return graph.compile()


_freelance_graph = build_freelance_workflow()


def run_freelance_workflow(workflow_id: str, user_id: str) -> dict:
    db = SessionLocal()
    try:
        run = db.scalar(select(WorkflowRun).where(
            WorkflowRun.id == workflow_id, WorkflowRun.user_id == user_id
        ))
        if not run:
            raise ValueError("Workflow not found")
        if run.status in {"running", "awaiting_approval", "approved", "completed", "rejected"}:
            return {"workflow_id": run.id, "status": run.status, "proposal_id": run.proposal_id}
        user = db.get(User, user_id)
        opportunity = db.scalar(select(Opportunity).where(
            Opportunity.id == run.opportunity_id, Opportunity.user_id == user_id
        ))
        if not user or not opportunity:
            raise ValueError("Workflow user or opportunity no longer exists")
        profile = profile_dict(db, user)
        evidence_rows = db.scalars(select(ClientResearch).where(
            ClientResearch.user_id == user_id,
            ClientResearch.opportunity_id == opportunity.id,
        ).order_by(ClientResearch.created_at.asc())).all()
        evidence = [{
            "claim": row.claim,
            "evidence_url": row.evidence_url,
            "confidence": row.confidence,
            "evidence_type": row.evidence_type,
        } for row in evidence_rows]
        opportunity_data = {
            "id": opportunity.id,
            "source": opportunity.source,
            "title": opportunity.title,
            "client_name": opportunity.client_name,
            "description": opportunity.description,
            "source_url": opportunity.source_url,
            "budget_min": opportunity.budget_min,
            "budget_max": opportunity.budget_max,
            "currency": opportunity.currency,
            "required_skills": json.loads(opportunity.required_skills or "[]"),
            "deadline": opportunity.deadline,
            "job_type": opportunity.job_type,
            "industry": opportunity.industry,
            "estimated_hours": opportunity.estimated_hours,
            "competition_level": opportunity.competition_level,
            "client_rating": opportunity.client_rating,
            "client_reviews": opportunity.client_reviews,
            "client_payment_verified": opportunity.client_payment_verified,
        }
        saved_state = json.loads(run.state_json or "{}")
        run.status = "running"
        run.started_at = run.started_at or datetime.now(timezone.utc)
        run.current_step = "resuming_from_checkpoint" if "profile" in saved_state else "starting"
        run.updated_at = datetime.now(timezone.utc)
        db.commit()
        state = {
            "run_id": run.id,
            "user_id": user_id,
            "opportunity_id": opportunity.id,
            "profile": profile,
            "opportunity": opportunity_data,
            "evidence": evidence,
            "estimated_hours": opportunity.estimated_hours or 8.0,
            "proposed_price": run.proposed_price,
            "currency": run.currency or opportunity.currency,
        }
        # Restore the last committed node snapshot on retry. The workflow nodes
        # skip stages whose durable outputs are already present.
        if "profile" in saved_state and "opportunity" in saved_state:
            state.update(saved_state)
    finally:
        db.close()

    try:
        result = _freelance_graph.invoke(state)
        return {
            "workflow_id": workflow_id,
            "status": "awaiting_approval",
            "proposal_id": result.get("proposal_id"),
            "match_score": result.get("match_score"),
            "pricing_advice": result.get("pricing_advice"),
        }
    except Exception as exc:
        db = SessionLocal()
        try:
            run = db.get(WorkflowRun, workflow_id)
            if run and run.status not in {"awaiting_approval", "approved", "completed"}:
                run.status = "failed"
                run.error_message = str(exc)[:2000]
                run.current_step = "failed"
                run.updated_at = datetime.now(timezone.utc)
                run.finished_at = datetime.now(timezone.utc)
                db.commit()
        finally:
            db.close()
        raise

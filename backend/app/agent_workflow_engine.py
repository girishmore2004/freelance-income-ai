"""Durable, read-only multi-agent business workflow.

Every specialist node persists a JSON-safe checkpoint before the graph advances.
The graph produces recommendations only; it never performs external actions.
"""
import json
import asyncio
import time
from datetime import datetime, timezone, date
from zoneinfo import ZoneInfo
from typing import Any, TypedDict

from langgraph.graph import StateGraph, START, END
from sqlalchemy import select, func

from .database import SessionLocal
from .models import (
    AgentWorkflowRun, AgentWorkflowCheckpoint, Profile, Opportunity,
    ClientResearch, Project, ProjectTask, ProjectDeliverable, Invoice,
    Feedback, ClientEmail, PortfolioChunk, PortfolioDocument,
)
from .agents.specialists import matching_agent, research_agent, delivery_agent, finance_agent
from .agents import proposal_agent
from .services.retrieval import rank_chunks
from .services.agent_workflow_planner import build_action_plan
from .services.client_communication_planner import build_communication_plan
from .services.workflow_operations import classify_workflow_error, guard_node


class AgentWorkflowState(TypedDict, total=False):
    workflow_id: str
    user_id: str
    workflow_type: str
    execution_attempt: int
    profile: dict[str, Any]
    opportunities: list[dict[str, Any]]
    research: list[dict[str, Any]]
    projects: list[dict[str, Any]]
    tasks: list[dict[str, Any]]
    deliverables: list[dict[str, Any]]
    invoices: list[dict[str, Any]]
    feedback: list[dict[str, Any]]
    client_emails: list[dict[str, Any]]
    portfolio_chunks: list[dict[str, Any]]
    matching_result: dict[str, Any]
    research_result: dict[str, Any]
    delivery_result: dict[str, Any]
    finance_result: dict[str, Any]
    proposal_strategy_result: dict[str, Any]
    communication_result: dict[str, Any]
    action_plan: list[dict[str, Any]]
    agent_trace: list[dict[str, Any]]


def _safe(value):
    return json.loads(json.dumps(value, default=str))


def _checkpoint(state: AgentWorkflowState, node: str, updates: dict[str, Any]):
    merged = dict(state)
    updates = dict(updates)
    duration_ms = updates.pop("_duration_ms", None)
    merged.update(updates)
    trace_item = {
        "agent": node, "status": "completed",
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
    if duration_ms is not None:
        trace_item["duration_ms"] = max(0, int(duration_ms))
    merged["agent_trace"] = list(merged.get("agent_trace", [])) + [trace_item]
    payload = _safe(merged)
    db = SessionLocal()
    try:
        run = db.scalar(select(AgentWorkflowRun).where(
            AgentWorkflowRun.id == state["workflow_id"],
            AgentWorkflowRun.user_id == state["user_id"],
        ).with_for_update())
        if not run:
            raise ValueError("Agent workflow not found")
        if run.status != "running" or run.attempt_count != state.get("execution_attempt"):
            raise RuntimeError("This worker attempt was superseded; refusing to write a stale checkpoint")
        sequence = (db.scalar(select(func.max(AgentWorkflowCheckpoint.sequence)).where(
            AgentWorkflowCheckpoint.workflow_id == run.id
        )) or 0) + 1
        run.current_step = node
        run.state_json = json.dumps(payload)
        run.updated_at = datetime.now(timezone.utc)
        db.add(AgentWorkflowCheckpoint(
            workflow_id=run.id, sequence=sequence, node_name=node,
            state_json=json.dumps(payload),
        ))
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return {"agent_trace": payload["agent_trace"], **updates}


def _load_context(state):
    node_started = time.monotonic()
    if "opportunities" in state:
        return {}
    db = SessionLocal()
    try:
        uid = state["user_id"]
        profile_row = db.scalar(select(Profile).where(Profile.user_id == uid))
        timezone_name = profile_row.timezone if profile_row and profile_row.timezone else "UTC"
        try:
            local_today = datetime.now(ZoneInfo(timezone_name)).date().isoformat()
        except Exception:
            local_today = datetime.now(timezone.utc).date().isoformat()
        profile = {
            "full_name": profile_row.full_name if profile_row else "",
            "headline": profile_row.headline if profile_row else "",
            "bio": profile_row.bio if profile_row else "",
            "skills": json.loads(profile_row.skills or "[]") if profile_row else [],
            "services": json.loads(profile_row.services or "[]") if profile_row else [],
            "portfolio_links": json.loads(profile_row.portfolio_links or "[]") if profile_row else [],
            "minimum_budget": profile_row.minimum_budget if profile_row else 0,
            "weekly_hours": profile_row.weekly_hours if profile_row else 10,
            "hourly_rate": profile_row.hourly_rate if profile_row else 0,
            "currency": profile_row.currency if profile_row else "INR",
            "timezone": timezone_name,
        }
        opportunities = db.scalars(select(Opportunity).where(
            Opportunity.user_id == uid, Opportunity.status.in_(["new", "saved", "shortlisted", "applied"])
        ).order_by(Opportunity.created_at.desc()).limit(100)).all()
        research = db.scalars(select(ClientResearch).where(
            ClientResearch.user_id == uid
        ).order_by(ClientResearch.created_at.desc()).limit(200)).all()
        projects = db.scalars(select(Project).where(
            Project.user_id == uid, Project.status.notin_(["completed", "cancelled"])
        ).order_by(Project.created_at.desc()).limit(100)).all()
        tasks = db.scalars(select(ProjectTask).where(
            ProjectTask.user_id == uid, ProjectTask.status.notin_(["done", "completed", "cancelled"])
        ).order_by(ProjectTask.created_at.desc()).limit(300)).all()
        deliverables = db.scalars(select(ProjectDeliverable).where(
            ProjectDeliverable.user_id == uid
        ).order_by(ProjectDeliverable.created_at.desc()).limit(200)).all()
        invoices = db.scalars(select(Invoice).where(
            Invoice.user_id == uid
        ).order_by(Invoice.created_at.desc()).limit(200)).all()
        feedback = db.scalars(select(Feedback).where(
            Feedback.user_id == uid
        ).order_by(Feedback.created_at.desc()).limit(200)).all()
        client_emails = db.scalars(select(ClientEmail).where(
            ClientEmail.user_id == uid
        ).order_by(ClientEmail.received_at.desc()).limit(30)).all()
        portfolio_chunks = db.scalars(select(PortfolioChunk).where(
            PortfolioChunk.user_id == uid
        ).order_by(PortfolioChunk.created_at.desc()).limit(60)).all()
        document_ids = {x.document_id for x in portfolio_chunks}
        portfolio_documents = db.scalars(select(PortfolioDocument).where(
            PortfolioDocument.user_id == uid, PortfolioDocument.id.in_(document_ids)
        )).all() if document_ids else []
        portfolio_names = {x.id: x.filename for x in portfolio_documents}
        opp_data = [{
            "id": x.id, "title": x.title, "description": x.description,
            "required_skills": json.loads(x.required_skills or "[]"),
            "budget_min": x.budget_min, "budget_max": x.budget_max,
            "currency": x.currency, "deadline": x.deadline,
            "estimated_hours": x.estimated_hours, "industry": x.industry,
            "client_rating": x.client_rating, "client_reviews": x.client_reviews,
            "client_payment_verified": x.client_payment_verified,
        } for x in opportunities]
        research_data = [{
            "id": x.id, "opportunity_id": x.opportunity_id, "claim": x.claim,
            "evidence_url": x.evidence_url, "confidence": x.confidence,
        } for x in research]
        project_data = [{
            "id": x.id, "title": x.title, "client_name": x.client_name,
            "description": (x.description or "")[:1200], "due_date": x.due_date, "status": x.status,
        } for x in projects]
        task_data = [{
            "id": x.id, "project_id": x.project_id, "title": x.title,
            "due_date": x.due_date, "priority": x.priority, "status": x.status,
        } for x in tasks]
        deliverable_data = [{
            "id": x.id, "project_id": x.project_id, "title": x.title,
            "due_date": x.due_date, "status": x.status,
        } for x in deliverables]
        invoice_data = [{
            "id": x.id, "project_id": x.project_id, "invoice_number": x.invoice_number,
            "amount": x.amount, "currency": x.currency, "due_date": x.due_date,
            "status": x.status,
        } for x in invoices]
        feedback_data = [{"id": x.id, "outcome": x.outcome, "reason": x.reason} for x in feedback]
        email_data = [{
            "id": x.id, "sender_name": x.sender_name, "sender_email": x.sender_email,
            "subject": x.subject, "body_text": (x.body_text or "")[:1000],
            "received_at": x.received_at.isoformat(), "category": x.category,
            "urgency": x.urgency, "urgency_score": x.urgency_score,
            "project_id": x.project_id, "status": x.status,
        } for x in client_emails]
        portfolio_data = [{
            "id": x.id, "document_id": x.document_id, "chunk_index": x.chunk_index,
            "content": x.content[:1200],
            "embedding": json.loads(x.embedding_json or "[]"),
            "filename": portfolio_names.get(x.document_id, "Portfolio document"),
        } for x in portfolio_chunks]
    finally:
        db.close()
    return _checkpoint(state, "context_loader", {
        "profile": profile, "today": local_today, "opportunities": opp_data, "research": research_data,
        "projects": project_data, "tasks": task_data, "deliverables": deliverable_data,
        "invoices": invoice_data, "feedback": feedback_data,
        "client_emails": email_data, "portfolio_chunks": portfolio_data,
        "_duration_ms": (time.monotonic() - node_started) * 1000,
    })


def _matching_node(state):
    node_started = time.monotonic()
    if "matching_result" in state:
        return {}
    profile = state.get("profile", {})
    ranked = []
    for item in state.get("opportunities", []):
        result = matching_agent(profile, item)
        ranked.append({
            "opportunity_id": item["id"], "title": item["title"],
            "score": result["score"], "breakdown": result["breakdown"],
        })
    ranked.sort(key=lambda x: x["score"], reverse=True)
    return _checkpoint(state, "opportunity_matching_agent", {
        "matching_result": {"agent": "matching_agent", "ranked_opportunities": ranked[:10],
                            "evaluated_count": len(ranked)},
        "_duration_ms": (time.monotonic() - node_started) * 1000,
    })


def _research_node(state):
    node_started = time.monotonic()
    if "research_result" in state:
        return {}
    evidence = state.get("research", [])
    result = research_agent(evidence)
    result["evidence_count"] = len(evidence)
    result["scope_note"] = "This agent summarizes saved evidence labels; it does not independently verify client claims or URLs."
    return _checkpoint(state, "client_research_agent", {
        "research_result": result, "_duration_ms": (time.monotonic() - node_started) * 1000
    })


def _delivery_node(state):
    node_started = time.monotonic()
    if "delivery_result" in state:
        return {}
    projects = state.get("projects", [])
    tasks = state.get("tasks", [])
    deliverables = state.get("deliverables", [])
    project_summaries = []
    for project in projects:
        related_tasks = [x for x in tasks if x["project_id"] == project["id"]]
        related_deliverables = [x for x in deliverables if x["project_id"] == project["id"]]
        project_summaries.append({
            "project_id": project["id"], "title": project["title"],
            "task_summary": delivery_agent(project, related_tasks),
            "open_deliverables": len([x for x in related_deliverables if x["status"] not in {"approved", "delivered"}]),
            "due_date": project["due_date"],
        })
    today = state.get("today") or datetime.now(timezone.utc).date().isoformat()
    overdue_tasks = [x for x in tasks if x["due_date"] and x["due_date"][:10] < today]
    overdue_deliverables = [x for x in deliverables if x["due_date"] and x["due_date"][:10] < today
                            and x["status"] not in {"approved", "delivered"}]
    overdue_projects = [x for x in projects if x["due_date"] and x["due_date"][:10] < today]
    return _checkpoint(state, "delivery_agent", {
        "delivery_result": {
            "agent": "delivery_agent", "active_project_count": len(projects),
            "open_task_count": len(tasks), "overdue_tasks": overdue_tasks,
            "overdue_deliverables": overdue_deliverables, "overdue_projects": overdue_projects,
            "projects": project_summaries,
        },
        "_duration_ms": (time.monotonic() - node_started) * 1000,
    })


def _finance_node(state):
    node_started = time.monotonic()
    if "finance_result" in state:
        return {}
    invoices = state.get("invoices", [])
    result = finance_agent(invoices)
    today = state.get("today") or datetime.now(timezone.utc).date().isoformat()
    result.update({
        "agent": "finance_agent",
        "overdue_invoices": [x for x in invoices if x["status"] in {"unpaid", "overdue"} and x["due_date"] and x["due_date"][:10] < today],
        "unpaid_invoice_count": sum(1 for x in invoices if x["status"] in {"unpaid", "overdue"}),
        "currency_warning": "Totals are not converted across currencies; review invoice currency before aggregating.",
    })
    return _checkpoint(state, "finance_agent", {
        "finance_result": result, "_duration_ms": (time.monotonic() - node_started) * 1000
    })


def _proposal_strategy_node(state):
    node_started = time.monotonic()
    if "proposal_strategy_result" in state:
        return {}
    if state.get("workflow_type") not in {"business_review", "opportunity_plan"}:
        return _checkpoint(state, "proposal_strategist_agent", {
            "proposal_strategy_result": {"agent": "proposal_strategist", "draft_count": 0, "drafts": [],
                                         "note": "Skipped for this workflow type."},
            "_duration_ms": (time.monotonic() - node_started) * 1000,
        })
    profile = state.get("profile", {})
    ranked = state.get("matching_result", {}).get("ranked_opportunities", [])
    opportunity_by_id = {x["id"]: x for x in state.get("opportunities", [])}
    drafts = []
    for ranked_item in ranked[:3]:
        if ranked_item.get("score", 0) < 60:
            continue
        opportunity = opportunity_by_id.get(ranked_item["opportunity_id"])
        if not opportunity:
            continue
        budget_reference = opportunity.get("budget_max")
        # A client's maximum budget is not the freelancer's proposed price.
        # Leave commercial terms open unless the user has explicitly supplied a price.
        price = None
        try:
            content, mode = asyncio.run(asyncio.wait_for(
                proposal_agent(profile, opportunity, price), timeout=40
            ))
        except Exception:
            content = (
                f"Hello,\n\nI reviewed your project: {opportunity['title']}. "
                "I would first confirm the scope, required inputs and acceptance criteria, "
                "then agree on milestones before implementation and testing. "
                "Could you clarify the expected deliverables, integrations and timeline?\n\n"
                "Regards,\n" + (profile.get("full_name") or "Your name")
            )
            mode = "safe_template_timeout_fallback"
        drafts.append({
            "opportunity_id": opportunity["id"], "title": opportunity["title"],
            "match_score": ranked_item["score"], "proposed_price": None,
            "client_budget_max_reference": budget_reference,
            "currency": opportunity.get("currency", profile.get("currency", "INR")),
            "draft_content": content, "generation_mode": mode,
            "evidence": [{"type": "opportunity", "id": opportunity["id"]},
                         {"type": "profile", "id": state["user_id"]}],
            "requires_human_review": True,
            "external_submission": "not_performed",
        })
    return _checkpoint(state, "proposal_strategist_agent", {
        "proposal_strategy_result": {
            "agent": "proposal_strategist", "draft_count": len(drafts),
            "drafts": drafts,
            "note": "Drafts are workflow suggestions only and are not saved as proposals or submitted externally. Use the existing proposal workflow to create an editable, approval-tracked proposal.",
        },
        "_duration_ms": (time.monotonic() - node_started) * 1000,
    })


def _communication_node(state):
    node_started = time.monotonic()
    if "communication_result" in state:
        return {}
    if state.get("workflow_type") != "business_review":
        return _checkpoint(state, "client_communication_agent", {
            "communication_result": {"agent": "client_communication_planner", "review_count": 0,
                                     "recommendations": [], "policy": "Skipped for this workflow type."},
            "_duration_ms": (time.monotonic() - node_started) * 1000,
        })
    recommendations = build_communication_plan(
        state.get("client_emails", []), state.get("profile", {}),
        state.get("projects", []), state.get("portfolio_chunks", []), limit=30,
    )
    return _checkpoint(state, "client_communication_agent", {
        "communication_result": {
            "agent": "client_communication_planner",
            "review_count": len(recommendations),
            "recommendations": recommendations[:30],
            "policy": "Planning only. No email draft is saved, no reminder is created and no message is sent.",
        },
        "_duration_ms": (time.monotonic() - node_started) * 1000,
    })


def _planner_node(state):
    node_started = time.monotonic()
    if "action_plan" in state:
        return {}
    return _checkpoint(state, "business_planner", {
        "action_plan": build_action_plan(state),
        "_duration_ms": (time.monotonic() - node_started) * 1000,
    })


def _record_agent_failure(state, node_name, exc):
    """Persist bounded stage failure metadata without exposing account snapshots."""
    db = SessionLocal()
    try:
        run = db.scalar(select(AgentWorkflowRun).where(
            AgentWorkflowRun.id == state.get("workflow_id"),
            AgentWorkflowRun.user_id == state.get("user_id"),
        ).with_for_update())
        if not run or run.status != "running" or run.attempt_count != state.get("execution_attempt"):
            return
        run.error_code = classify_workflow_error(exc)
        run.last_error_node = node_name[:80]
        run.error_message = "Agent stage failed. Check server-side diagnostics using the error code and stage."
        run.current_step = ("failed:" + node_name)[:80]
        run.updated_at = datetime.now(timezone.utc)
        db.commit()
    except Exception:
        db.rollback()
        # Outer workflow failure handler remains the final safety net.
    finally:
        db.close()


def build_agent_workflow():
    graph = StateGraph(AgentWorkflowState)
    graph.add_node("context_loader", guard_node("context_loader", _load_context, _record_agent_failure))
    graph.add_node("matching", guard_node("matching", _matching_node, _record_agent_failure))
    graph.add_node(
    "client_research",
    guard_node("client_research", _research_node, _record_agent_failure),
    )
    graph.add_node("delivery", guard_node("delivery", _delivery_node, _record_agent_failure))
    graph.add_node("finance", guard_node("finance", _finance_node, _record_agent_failure))
    graph.add_node("proposal_strategy", guard_node("proposal_strategy", _proposal_strategy_node, _record_agent_failure))
    graph.add_node("communication", guard_node("communication", _communication_node, _record_agent_failure))
    graph.add_node("planner", guard_node("planner", _planner_node, _record_agent_failure))
    graph.add_edge(START, "context_loader")
    graph.add_edge("context_loader", "matching")
    graph.add_edge("matching", "client_research")
    graph.add_edge("client_research", "delivery")
    graph.add_edge("delivery", "finance")
    graph.add_edge("finance", "proposal_strategy")
    graph.add_edge("proposal_strategy", "communication")
    graph.add_edge("communication", "planner")
    graph.add_edge("planner", END)
    return graph.compile()


_agent_graph = build_agent_workflow()


def run_agent_workflow(workflow_id: str, user_id: str) -> dict:
    db = SessionLocal()
    try:
        run = db.scalar(select(AgentWorkflowRun).where(
            AgentWorkflowRun.id == workflow_id, AgentWorkflowRun.user_id == user_id
        ).with_for_update())
        if not run:
            raise ValueError("Agent workflow not found")
        if run.status == "completed":
            return {"workflow_id": run.id, "status": "completed", "result": json.loads(run.result_json or "{}")}
        if run.status == "cancelled":
            return {"workflow_id": run.id, "status": "cancelled"}
        if run.status == "running":
            return {"workflow_id": run.id, "status": "running"}
        if run.attempt_count >= run.max_attempts:
            raise ValueError("Maximum workflow attempts reached")
        run.status = "running"
        run.attempt_count += 1
        run.started_at = run.started_at or datetime.now(timezone.utc)
        run.current_step = "resuming" if run.state_json and run.state_json != "{}" else "starting"
        run.error_message = ""
        run.error_code = ""
        run.last_error_node = ""
        run.updated_at = datetime.now(timezone.utc)
        state = json.loads(run.state_json or "{}")
        state.update({
            "workflow_id": run.id, "user_id": user_id,
            "workflow_type": run.workflow_type, "execution_attempt": run.attempt_count,
        })
        db.commit()
    finally:
        db.close()

    try:
        result = _agent_graph.invoke(state)
        workflow_type = state["workflow_type"]
        category_by_type = {
            "opportunity_plan": {"opportunity"},
            "delivery_review": {"delivery"},
            "finance_review": {"finance"},
        }
        allowed_categories = category_by_type.get(workflow_type)
        all_actions = result.get("action_plan", [])
        visible_actions = [
            item for item in all_actions
            if allowed_categories is None or item.get("category") in allowed_categories
        ]
        output = {
            "workflow_type": workflow_type,
            "matching": result.get("matching_result", {}),
            "research": result.get("research_result", {}),
            "delivery": result.get("delivery_result", {}),
            "finance": result.get("finance_result", {}),
            "proposal_strategy": result.get("proposal_strategy_result", {}),
            "communication": result.get("communication_result", {}),
            "action_plan": visible_actions,
            "total_recommendations_before_filter": len(all_actions),
            "agent_trace": result.get("agent_trace", []),
            "policy": "Read-only recommendations. No email, proposal, marketplace, delivery, invoice or payment action is executed.",
        }
        db = SessionLocal()
        try:
            run = db.scalar(select(AgentWorkflowRun).where(
                AgentWorkflowRun.id == workflow_id, AgentWorkflowRun.user_id == user_id
            ).with_for_update())
            if not run or run.status != "running" or run.attempt_count != state.get("execution_attempt"):
                raise RuntimeError("This worker attempt was superseded before completion")
            run.result_json = json.dumps(_safe(output))
            run.status = "completed"
            run.current_step = "completed"
            run.error_message = ""
            run.finished_at = datetime.now(timezone.utc)
            run.updated_at = datetime.now(timezone.utc)
            db.commit()
        finally:
            db.close()
        return {"workflow_id": workflow_id, "status": "completed", "result": output}
    except Exception as exc:
        db = SessionLocal()
        try:
            run = db.scalar(select(AgentWorkflowRun).where(
                AgentWorkflowRun.id == workflow_id, AgentWorkflowRun.user_id == user_id
            ))
            if run and run.status == "running" and run.attempt_count == state.get("execution_attempt"):
                run.status = "failed"
                run.error_message = "Workflow execution failed. Check server-side diagnostics using the error code and stage."
                run.error_code = classify_workflow_error(exc)
                run.last_error_node = run.last_error_node or run.current_step or "unknown"
                run.current_step = "failed"
                run.finished_at = datetime.now(timezone.utc)
                run.updated_at = datetime.now(timezone.utc)
                db.commit()
        finally:
            db.close()
        raise

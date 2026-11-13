"""API for durable read-only multi-agent business workflows."""
import json
import uuid
from datetime import datetime, timezone, timedelta
from ..services.rq_submission import enqueue_once
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, delete
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, AgentWorkflowRun, AgentWorkflowCheckpoint, AIUsageEvent
from ..security import current_user
from ..queue import get_queue
from ..services.workflow_operations import summarize_workflow_runs
from ..services.usage_quota import enforce_quota

router = APIRouter(prefix="/api/v1/agent-workflows", tags=["agent-workflows"])


class AgentWorkflowStart(BaseModel):
    workflow_type: str = Field(default="business_review", pattern="^(business_review|opportunity_plan|delivery_review|finance_review)$")
    idempotency_key: str = Field(default="", max_length=100)


def _out(run):
    return {
        "id": run.id, "workflow_id": run.id, "workflow_type": run.workflow_type, "status": run.status,
        "current_step": run.current_step, "attempt_count": run.attempt_count,
        "max_attempts": run.max_attempts, "error": run.error_message, "error_code": getattr(run, "error_code", ""),
        "last_error_node": getattr(run, "last_error_node", ""),
        "result": json.loads(run.result_json or "{}"),
        "created_at": run.created_at.isoformat(),
        "updated_at": run.updated_at.isoformat(),
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
    }




def _enqueue(run, user_id, db):
    """
    Submit one deterministic RQ job per workflow attempt and persist
    its queue ID for future recovery and diagnostics.
    """
    attempt_number = int(run.attempt_count or 0) + 1
    deterministic_job_id = (
        f"agent-workflow-{run.id}-attempt-{attempt_number}"
    )

    submitted = False

    try:
        queue = get_queue()

        job = queue.enqueue(
            "app.agent_workflow_engine.run_agent_workflow",
            run.id,
            user_id,
            job_id=deterministic_job_id,
            job_timeout=900,
            result_ttl=86400,
            failure_ttl=604800,
        )
        submitted = True

        run.rq_job_id = job.id
        run.status = "queued"
        run.current_step = "queued"
        run.error_message = ""
        run.error_code = ""
        run.last_error_node = ""
        run.finished_at = None
        run.updated_at = datetime.now(timezone.utc)

        db.commit()

        return {
            "workflow_id": run.id,
            "status": "queued",
            "queue_job_id": job.id,
            "attempt_number": attempt_number,
        }

    except Exception as exc:
        db.rollback()

        if not submitted:
            # Queue submission itself failed. Persist a recoverable
            # failure state so the user can explicitly retry.
            persisted_run = db.scalar(
                select(AgentWorkflowRun).where(
                    AgentWorkflowRun.id == run.id,
                    AgentWorkflowRun.user_id == user_id,
                ).with_for_update()
            )

            if persisted_run:
                persisted_run.status = "failed"
                persisted_run.current_step = "queue_failed"
                persisted_run.error_message = (
                    "Workflow queue unavailable. Check REDIS_URL "
                    "and the RQ worker."
                )
                persisted_run.finished_at = datetime.now(timezone.utc)
                persisted_run.updated_at = datetime.now(timezone.utc)
                db.commit()

            raise HTTPException(
                503,
                "Workflow queue unavailable. Check REDIS_URL and the RQ worker.",
            ) from exc

        # Redis accepted the job, but the database update did not
        # complete. Do not mark the workflow failed: the worker may
        # already be able to execute it. Recovery can use the
        # deterministic job ID to locate the submitted RQ job.
        raise HTTPException(
            503,
            "The workflow was submitted but its queue record could not "
            "be confirmed in the database. Check workflow status before "
            "retrying.",
        ) from exc




@router.post("")
def start_agent_workflow(data: AgentWorkflowStart, user: User = Depends(current_user), db: Session = Depends(get_db)):
    key = data.idempotency_key.strip() or str(uuid.uuid4())
    existing = db.scalar(select(AgentWorkflowRun).where(
        AgentWorkflowRun.user_id == user.id, AgentWorkflowRun.idempotency_key == key
    ))
    if existing:
        return {**_out(existing), "idempotent_replay": True}
    allowed, totals = enforce_quota(db, user.id, "agent_workflow:" + data.workflow_type)
    if not allowed:
        raise HTTPException(
            429,
            detail={"message": "AI usage quota reached", "usage": totals},
            headers={"Retry-After": "3600"},
        )
    run = AgentWorkflowRun(
        user_id=user.id, workflow_type=data.workflow_type,
        idempotency_key=key, status="queued", current_step="queued",
    )
    db.add(run)
    try:
        # Commit the workflow row and its quota event atomically. This counts
        # one initiated operation, not model tokens or monetary cost.
        db.add(AIUsageEvent(
            user_id=user.id,
            operation=("agent_workflow:" + data.workflow_type)[:80],
            provider="workflow",
            input_chars=0,
            output_chars=0,
        ))
        db.commit()
        db.refresh(run)
    except Exception:
        db.rollback()
        existing = db.scalar(select(AgentWorkflowRun).where(
            AgentWorkflowRun.user_id == user.id, AgentWorkflowRun.idempotency_key == key
        ))
        if existing:
            return {**_out(existing), "idempotent_replay": True}
        raise
    return _enqueue(run, user.id, db)


@router.get("")
def list_agent_workflows(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(AgentWorkflowRun).where(
        AgentWorkflowRun.user_id == user.id
    ).order_by(AgentWorkflowRun.created_at.desc()).limit(50)).all()
    return [_out(row) for row in rows]


@router.get("/metrics/summary")
def agent_workflow_metrics(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(AgentWorkflowRun).where(
        AgentWorkflowRun.user_id == user.id
    ).order_by(AgentWorkflowRun.created_at.desc()).limit(200)).all()
    return summarize_workflow_runs(rows)


@router.get("/{workflow_id}")
def get_agent_workflow(workflow_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    run = db.scalar(select(AgentWorkflowRun).where(
        AgentWorkflowRun.id == workflow_id, AgentWorkflowRun.user_id == user.id
    ))
    if not run:
        raise HTTPException(404, "Agent workflow not found")
    checkpoints = db.scalars(select(AgentWorkflowCheckpoint).where(
        AgentWorkflowCheckpoint.workflow_id == run.id
    ).order_by(AgentWorkflowCheckpoint.sequence.asc())).all()
    return {
        **_out(run),
        "checkpoints": [{
            "sequence": row.sequence, "node": row.node_name,
            "state_keys": sorted(json.loads(row.state_json or "{}").keys()),
            "summary": {
                "agent_trace_count": len(json.loads(row.state_json or "{}").get("agent_trace", [])),
                "opportunity_count": len(json.loads(row.state_json or "{}").get("opportunities", [])),
                "email_count": len(json.loads(row.state_json or "{}").get("client_emails", [])),
                "portfolio_chunk_count": len(json.loads(row.state_json or "{}").get("portfolio_chunks", [])),
            },
            "created_at": row.created_at.isoformat(),
        } for row in checkpoints],
    }


@router.post("/{workflow_id}/retry")
def retry_agent_workflow(workflow_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    run = db.scalar(select(AgentWorkflowRun).where(
        AgentWorkflowRun.id == workflow_id, AgentWorkflowRun.user_id == user.id
    ).with_for_update())
    if not run:
        raise HTTPException(404, "Agent workflow not found")
    if run.status == "running":
        updated_at = run.updated_at
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) - updated_at < timedelta(minutes=20):
            raise HTTPException(409, "Workflow is still active; retry is available after a stale worker lease expires")
        run.status = "failed"
        run.current_step = "stale_worker_recovery"
        run.error_message = "Worker heartbeat expired; retry will resume from the last committed checkpoint."
        db.commit()
    if run.status != "failed":
        raise HTTPException(409, "Only failed or stale workflows can be retried")
    if run.attempt_count >= run.max_attempts:
        raise HTTPException(409, "Maximum retry attempts reached")
    return _enqueue(run, user.id, db)


@router.post("/{workflow_id}/cancel")
def cancel_agent_workflow(workflow_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Cancel a run; an in-flight node is fenced at its next durable checkpoint."""
    run = db.scalar(select(AgentWorkflowRun).where(
        AgentWorkflowRun.id == workflow_id, AgentWorkflowRun.user_id == user.id
    ).with_for_update())
    if not run:
        raise HTTPException(404, "Agent workflow not found")
    if run.status not in {"queued", "running"}:
        raise HTTPException(409, "Only queued or running workflows can be cancelled")
    run.status = "cancelled"
    run.current_step = "cancelled"
    run.error_message = ""
    run.error_code = ""
    run.last_error_node = ""
    run.finished_at = datetime.now(timezone.utc)
    run.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"workflow_id": run.id, "status": "cancelled",
            "note": "An active worker cannot commit further checkpoints or complete this run."}


class WorkflowRetentionRequest(BaseModel):
    older_than_days: int = Field(default=90, ge=30, le=3650)
    dry_run: bool = True


@router.post("/retention/cleanup")
def cleanup_agent_workflows(data: WorkflowRetentionRequest, user: User = Depends(current_user), db: Session = Depends(get_db)):
    cutoff = datetime.now(timezone.utc) - timedelta(days=data.older_than_days)
    eligible = db.scalars(select(AgentWorkflowRun).where(
        AgentWorkflowRun.user_id == user.id,
        AgentWorkflowRun.status.in_(["completed", "failed", "cancelled"]),
        AgentWorkflowRun.finished_at.is_not(None),
        AgentWorkflowRun.finished_at < cutoff,
    )).all()
    ids = [row.id for row in eligible]
    if data.dry_run or not ids:
        return {"dry_run": data.dry_run, "eligible_count": len(ids), "deleted_count": 0,
                "older_than_days": data.older_than_days,
                "note": "Queued and running workflows are never eligible."}
    db.execute(delete(AgentWorkflowCheckpoint).where(AgentWorkflowCheckpoint.workflow_id.in_(ids)))
    db.execute(delete(AgentWorkflowRun).where(
        AgentWorkflowRun.id.in_(ids), AgentWorkflowRun.user_id == user.id,
        AgentWorkflowRun.status.in_(["completed", "failed", "cancelled"]),
    ))
    db.commit()
    return {"dry_run": False, "eligible_count": len(ids), "deleted_count": len(ids),
            "older_than_days": data.older_than_days,
            "note": "Only this user's terminal runs and their checkpoints were deleted."}

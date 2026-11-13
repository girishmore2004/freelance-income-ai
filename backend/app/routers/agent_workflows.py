
"""API for durable read-only multi-agent business workflows.

Responsibilities:
- Start and enqueue agent workflows.
- Support idempotent workflow creation.
- Track deterministic RQ job IDs.
- List and inspect workflow execution history.
- Retry failed and stale workflows.
- Cancel queued or running workflows.
- Clean up old terminal workflow records.

The database remains the source of truth. RQ provides asynchronous
execution, while agent_workflow_engine.py enforces execution-attempt
fencing and durable checkpoint validation.
"""

import json
import uuid

from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, delete
from sqlalchemy.orm import Session
from rq.job import Job

from ..database import get_db
from ..models import (
    User,
    AgentWorkflowRun,
    AgentWorkflowCheckpoint,
    AIUsageEvent,
)
from ..security import current_user
from ..queue import get_queue
from ..services.workflow_operations import summarize_workflow_runs
from ..services.usage_quota import enforce_quota


router = APIRouter(
    prefix="/api/v1/agent-workflows",
    tags=["agent-workflows"],
)

STALE_WORKFLOW_MINUTES = 20
WORKFLOW_JOB_TIMEOUT_SECONDS = 900
WORKFLOW_RESULT_TTL_SECONDS = 86400
WORKFLOW_FAILURE_TTL_SECONDS = 604800


# ---------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------

class AgentWorkflowStart(BaseModel):
    workflow_type: str = Field(
        default="business_review",
        pattern="^(business_review|opportunity_plan|delivery_review|finance_review)$",
    )

    idempotency_key: str = Field(
        default="",
        max_length=100,
    )


class WorkflowRetentionRequest(BaseModel):
    older_than_days: int = Field(
        default=90,
        ge=30,
        le=3650,
    )

    dry_run: bool = True


# ---------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------

def _safe_json(value, fallback=None):
    """Decode JSON without allowing malformed persisted data to break APIs."""

    if fallback is None:
        fallback = {}

    if not value:
        return fallback

    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return fallback


def _iso(value):
    """Serialize an optional datetime."""

    return value.isoformat() if value else None


def _out(run):
    """Return the public representation of a workflow record."""

    return {
        "id": run.id,
        "workflow_id": run.id,
        "workflow_type": run.workflow_type,
        "status": run.status,
        "current_step": run.current_step,
        "attempt_count": run.attempt_count,
        "max_attempts": run.max_attempts,
        "error": run.error_message,
        "error_code": getattr(run, "error_code", ""),
        "last_error_node": getattr(run, "last_error_node", ""),
        "queue_job_id": getattr(run, "rq_job_id", ""),
        "result": _safe_json(run.result_json),
        "created_at": _iso(run.created_at),
        "updated_at": _iso(run.updated_at),
        "finished_at": _iso(run.finished_at),
    }


# ---------------------------------------------------------------------
# Queue submission
# ---------------------------------------------------------------------

def _deterministic_job_id(run, attempt_number):
    """
    Generate one stable queue ID per workflow execution attempt.

    The workflow engine increments attempt_count when a worker actually
    starts execution. Therefore, the next scheduled attempt is
    attempt_count + 1.
    """

    return (
        f"agent-workflow-{run.id}-attempt-{attempt_number}"
    )


def _fetch_existing_job(queue, job_id):
    """Fetch an existing RQ job without exposing Redis credentials."""

    try:
        return Job.fetch(
            job_id,
            connection=queue.connection,
        )
    except Exception:
        return None


def _enqueue(run, user_id, db):
    """
    Submit an agent workflow to RQ.

    Duplicate queue submissions for the same workflow attempt reuse
    the existing RQ job ID.

    If queue submission succeeds but the subsequent database commit
    fails, the workflow is not incorrectly marked failed. The persisted
    workflow can be reconciled using its deterministic queue ID.
    """

    attempt_number = int(run.attempt_count or 0) + 1

    if attempt_number > int(run.max_attempts or 0):
        raise HTTPException(
            status_code=409,
            detail="Maximum retry attempts reached",
        )

    job_id = _deterministic_job_id(
        run,
        attempt_number,
    )

    queue = None
    job = None
    submission_succeeded = False

    try:
        queue = get_queue()

        try:
            job = queue.enqueue(
                "app.agent_workflow_engine.run_agent_workflow",
                run.id,
                user_id,
                job_id=job_id,
                job_timeout=WORKFLOW_JOB_TIMEOUT_SECONDS,
                result_ttl=WORKFLOW_RESULT_TTL_SECONDS,
                failure_ttl=WORKFLOW_FAILURE_TTL_SECONDS,
            )

            submission_succeeded = True

        except Exception:
            # An existing job with the same deterministic ID means
            # this attempt may already have been submitted.
            job = _fetch_existing_job(
                queue,
                job_id,
            )

            if job is None:
                raise

            submission_succeeded = True

        # Store the queue ID when the schema migration has been applied.
        # This keeps the router import-compatible during a rolling
        # deployment where the model migration has not yet been applied.
        if hasattr(run, "rq_job_id"):
            run.rq_job_id = job.id

        run.status = "queued"
        run.current_step = "queued"
        run.error_message = ""
        run.error_code = ""
        run.last_error_node = ""
        run.finished_at = None
        run.updated_at = datetime.now(timezone.utc)

        db.commit()
        db.refresh(run)

        return {
            "workflow_id": run.id,
            "status": "queued",
            "queue_job_id": job.id,
            "attempt_number": attempt_number,
        }

    except Exception as exc:
        db.rollback()

        if not submission_succeeded:
            # Queue submission itself failed.
            # Mark the record failed so the user can explicitly retry.
            try:
                persisted_run = db.scalar(
                    select(AgentWorkflowRun).where(
                        AgentWorkflowRun.id == run.id,
                        AgentWorkflowRun.user_id == user_id,
                    ).with_for_update()
                )

                if persisted_run and persisted_run.status != "cancelled":
                    persisted_run.status = "failed"
                    persisted_run.current_step = "queue_failed"
                    persisted_run.error_message = (
                        "Workflow queue unavailable. "
                        "Check REDIS_URL and the RQ worker."
                    )
                    persisted_run.finished_at = datetime.now(timezone.utc)
                    persisted_run.updated_at = datetime.now(timezone.utc)

                    db.commit()

            except Exception:
                db.rollback()

            raise HTTPException(
                status_code=503,
                detail=(
                    "Workflow queue unavailable. "
                    "Check REDIS_URL and the RQ worker."
                ),
            ) from exc

        # The queue accepted the job, but the database update could not
        # be confirmed. Do not mark the workflow failed because a worker
        # may already have started executing it.
        raise HTTPException(
            status_code=503,
            detail=(
                "Workflow submission could not be confirmed in the "
                "database. Check workflow status before retrying."
            ),
        ) from exc


# ---------------------------------------------------------------------
# Start workflow
# ---------------------------------------------------------------------

@router.post("")
def start_agent_workflow(
    data: AgentWorkflowStart,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """
    Create and enqueue a new durable agent workflow.

    The idempotency key prevents duplicate workflow records when clients
    retry an HTTP request after a network interruption.
    """

    key = data.idempotency_key.strip() or str(uuid.uuid4())

    if len(key) > 100:
        raise HTTPException(
            status_code=422,
            detail="Idempotency key cannot exceed 100 characters",
        )

    existing = db.scalar(
        select(AgentWorkflowRun).where(
            AgentWorkflowRun.user_id == user.id,
            AgentWorkflowRun.idempotency_key == key,
        )
    )

    if existing:
        return {
            **_out(existing),
            "idempotent_replay": True,
        }

    allowed, totals = enforce_quota(
        db,
        user.id,
        "agent_workflow:" + data.workflow_type,
    )

    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={
                "message": "AI usage quota reached",
                "usage": totals,
            },
            headers={
                "Retry-After": "3600",
            },
        )

    run = AgentWorkflowRun(
        user_id=user.id,
        workflow_type=data.workflow_type,
        idempotency_key=key,
        status="queued",
        current_step="queued",
    )

    db.add(run)

    try:
        # Commit the workflow record and quota event atomically.
        db.add(
            AIUsageEvent(
                user_id=user.id,
                operation=(
                    "agent_workflow:" + data.workflow_type
                )[:80],
                provider="workflow",
                input_chars=0,
                output_chars=0,
            )
        )

        db.commit()
        db.refresh(run)

    except Exception:
        db.rollback()

        # A concurrent request may have inserted the same idempotency
        # key. Return that existing record instead of creating another.
        existing = db.scalar(
            select(AgentWorkflowRun).where(
                AgentWorkflowRun.user_id == user.id,
                AgentWorkflowRun.idempotency_key == key,
            )
        )

        if existing:
            return {
                **_out(existing),
                "idempotent_replay": True,
            }

        raise

    return _enqueue(
        run,
        user.id,
        db,
    )


# ---------------------------------------------------------------------
# List workflows
# ---------------------------------------------------------------------

@router.get("")
def list_agent_workflows(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(AgentWorkflowRun)
        .where(AgentWorkflowRun.user_id == user.id)
        .order_by(AgentWorkflowRun.created_at.desc())
        .limit(50)
    ).all()

    return [
        _out(row)
        for row in rows
    ]


# ---------------------------------------------------------------------
# Workflow metrics
# ---------------------------------------------------------------------

@router.get("/metrics/summary")
def agent_workflow_metrics(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(AgentWorkflowRun)
        .where(AgentWorkflowRun.user_id == user.id)
        .order_by(AgentWorkflowRun.created_at.desc())
        .limit(200)
    ).all()

    return summarize_workflow_runs(rows)


# ---------------------------------------------------------------------
# Workflow details and checkpoints
# ---------------------------------------------------------------------

@router.get("/{workflow_id}")
def get_agent_workflow(
    workflow_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    run = db.scalar(
        select(AgentWorkflowRun).where(
            AgentWorkflowRun.id == workflow_id,
            AgentWorkflowRun.user_id == user.id,
        )
    )

    if not run:
        raise HTTPException(
            status_code=404,
            detail="Agent workflow not found",
        )

    checkpoints = db.scalars(
        select(AgentWorkflowCheckpoint)
        .where(
            AgentWorkflowCheckpoint.workflow_id == run.id
        )
        .order_by(
            AgentWorkflowCheckpoint.sequence.asc()
        )
    ).all()

    checkpoint_output = []

    for row in checkpoints:
        state = _safe_json(row.state_json)

        checkpoint_output.append({
            "sequence": row.sequence,
            "node": row.node_name,
            "state_keys": sorted(state.keys()),
            "summary": {
                "agent_trace_count": len(
                    state.get("agent_trace", [])
                ),
                "opportunity_count": len(
                    state.get("opportunities", [])
                ),
                "email_count": len(
                    state.get("client_emails", [])
                ),
                "portfolio_chunk_count": len(
                    state.get("portfolio_chunks", [])
                ),
            },
            "created_at": _iso(row.created_at),
        })

    return {
        **_out(run),
        "checkpoints": checkpoint_output,
    }


# ---------------------------------------------------------------------
# Retry workflow
# ---------------------------------------------------------------------

@router.post("/{workflow_id}/retry")
def retry_agent_workflow(
    workflow_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """
    Retry a failed workflow or recover a stale running workflow.

    The workflow engine resumes from its last committed checkpoint.
    """

    run = db.scalar(
        select(AgentWorkflowRun)
        .where(
            AgentWorkflowRun.id == workflow_id,
            AgentWorkflowRun.user_id == user.id,
        )
        .with_for_update()
    )

    if not run:
        raise HTTPException(
            status_code=404,
            detail="Agent workflow not found",
        )

    if run.status == "running":
        updated_at = run.updated_at

        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(
                tzinfo=timezone.utc
            )

        age = datetime.now(timezone.utc) - updated_at

        if age < timedelta(minutes=STALE_WORKFLOW_MINUTES):
            raise HTTPException(
                status_code=409,
                detail=(
                    "Workflow is still active; retry is available "
                    "after a stale worker lease expires"
                ),
            )

        run.status = "failed"
        run.current_step = "stale_worker_recovery"
        run.error_message = (
            "Worker heartbeat expired; retry will resume "
            "from the last committed checkpoint."
        )
        run.finished_at = datetime.now(timezone.utc)
        run.updated_at = datetime.now(timezone.utc)

        db.commit()
        db.refresh(run)

    if run.status != "failed":
        raise HTTPException(
            status_code=409,
            detail="Only failed or stale workflows can be retried",
        )

    if run.attempt_count >= run.max_attempts:
        raise HTTPException(
            status_code=409,
            detail="Maximum retry attempts reached",
        )

    return _enqueue(
        run,
        user.id,
        db,
    )


# ---------------------------------------------------------------------
# Cancel workflow
# ---------------------------------------------------------------------

@router.post("/{workflow_id}/cancel")
def cancel_agent_workflow(
    workflow_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """
    Cancel a queued or running workflow.

    The worker checks the durable workflow status before committing
    checkpoints and before marking a workflow completed.
    """

    run = db.scalar(
        select(AgentWorkflowRun)
        .where(
            AgentWorkflowRun.id == workflow_id,
            AgentWorkflowRun.user_id == user.id,
        )
        .with_for_update()
    )

    if not run:
        raise HTTPException(
            status_code=404,
            detail="Agent workflow not found",
        )

    if run.status not in {"queued", "running"}:
        raise HTTPException(
            status_code=409,
            detail="Only queued or running workflows can be cancelled",
        )

    run.status = "cancelled"
    run.current_step = "cancelled"
    run.error_message = ""
    run.error_code = ""
    run.last_error_node = ""
    run.finished_at = datetime.now(timezone.utc)
    run.updated_at = datetime.now(timezone.utc)

    db.commit()

    return {
        "workflow_id": run.id,
        "status": "cancelled",
        "note": (
            "An active worker cannot commit further checkpoints "
            "or complete this run."
        ),
    }


# ---------------------------------------------------------------------
# Retention cleanup
# ---------------------------------------------------------------------

@router.post("/retention/cleanup")
def cleanup_agent_workflows(
    data: WorkflowRetentionRequest,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """
    Preview or delete this user's old terminal workflow records.

    Queued and running workflows are never eligible for deletion.
    """

    cutoff = (
        datetime.now(timezone.utc)
        - timedelta(days=data.older_than_days)
    )

    eligible = db.scalars(
        select(AgentWorkflowRun).where(
            AgentWorkflowRun.user_id == user.id,
            AgentWorkflowRun.status.in_([
                "completed",
                "failed",
                "cancelled",
            ]),
            AgentWorkflowRun.finished_at.is_not(None),
            AgentWorkflowRun.finished_at < cutoff,
        )
    ).all()

    ids = [
        row.id
        for row in eligible
    ]

    if data.dry_run or not ids:
        return {
            "dry_run": data.dry_run,
            "eligible_count": len(ids),
            "deleted_count": 0,
            "older_than_days": data.older_than_days,
            "note": (
                "Queued and running workflows are never eligible."
            ),
        }

    db.execute(
        delete(AgentWorkflowCheckpoint).where(
            AgentWorkflowCheckpoint.workflow_id.in_(ids)
        )
    )

    deleted = db.execute(
        delete(AgentWorkflowRun).where(
            AgentWorkflowRun.id.in_(ids),
            AgentWorkflowRun.user_id == user.id,
            AgentWorkflowRun.status.in_([
                "completed",
                "failed",
                "cancelled",
            ]),
        )
    )

    db.commit()

    return {
        "dry_run": False,
        "eligible_count": len(ids),
        "deleted_count": deleted.rowcount or 0,
        "older_than_days": data.older_than_days,
        "note": (
            "Only this user's terminal runs and their checkpoints "
            "were deleted."
        ),
    }

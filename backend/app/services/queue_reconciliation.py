
"""Read-only reconciliation diagnostics for durable agent workflows.

This service compares persisted AgentWorkflowRun records with their
RQ jobs. It never enqueues, cancels, deletes, retries, or changes a
workflow.

All findings are diagnostic recommendations. A separate, explicitly
authorized recovery operation should perform any state changes.
"""

import logging

from datetime import datetime, timezone, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session
from rq.job import Job

from ..models import AgentWorkflowRun
from ..queue import get_queue


logger = logging.getLogger(__name__)

DEFAULT_STALE_MINUTES = 20
MAX_SCAN_LIMIT = 500

TERMINAL_WORKFLOW_STATUSES = {
    "completed",
    "failed",
    "cancelled",
}

ACTIVE_WORKFLOW_STATUSES = {
    "queued",
    "running",
}


def _utc(value: datetime | None) -> datetime | None:
    """Normalize a database datetime to UTC."""

    if value is None:
        return None

    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)

    return value.astimezone(timezone.utc)


def _age_seconds(value: datetime | None) -> int | None:
    """Return the age of a timestamp in seconds."""

    normalized = _utc(value)

    if normalized is None:
        return None

    return max(
        0,
        int(
            (
                datetime.now(timezone.utc) - normalized
            ).total_seconds()
        ),
    )


def _job_status(queue, job_id: str) -> dict[str, Any]:
    """Inspect an RQ job without modifying it."""

    if not job_id:
        return {
            "exists": False,
            "status": "untracked",
            "error": None,
        }

    try:
        job = Job.fetch(
            job_id,
            connection=queue.connection,
        )

        status = job.get_status(refresh=True)

        if hasattr(status, "value"):
            status = status.value

        return {
            "exists": True,
            "status": str(status),
            "error": None,
        }

    except Exception as exc:
        # Job.fetch can fail because the job does not exist, Redis is
        # unavailable, or the job record is temporarily inaccessible.
        # Do not incorrectly classify every fetch error as a missing job.
        logger.warning(
            "Unable to inspect RQ job %s: %s",
            job_id,
            type(exc).__name__,
        )

        return {
            "exists": False,
            "status": "unknown",
            "error": type(exc).__name__,
        }


def _classify_workflow(
    run: AgentWorkflowRun,
    job_info: dict[str, Any] | None,
    stale_after_minutes: int,
) -> dict[str, Any]:
    """Classify one workflow without changing its database state."""

    workflow_status = str(run.status or "unknown")
    job_status = (
        job_info.get("status")
        if job_info
        else "untracked"
    )

    age = _age_seconds(run.updated_at)
    stale_seconds = stale_after_minutes * 60

    finding = "healthy"
    recommendation = "No action required."

    if workflow_status in TERMINAL_WORKFLOW_STATUSES:
        finding = "terminal"
        recommendation = (
            "Workflow is already terminal. Do not resubmit it."
        )

    elif workflow_status == "queued":
        if job_status == "queued":
            finding = "queued"
            recommendation = (
                "RQ reports the job as queued. Check worker availability "
                "if it remains queued."
            )

        elif job_status in {"started", "deferred", "scheduled"}:
            finding = "queue_active"
            recommendation = (
                "RQ has an active or scheduled job. Continue monitoring."
            )

        elif job_status in {"finished"}:
            finding = "state_mismatch"
            recommendation = (
                "RQ reports completion while the database still says "
                "queued. Inspect worker logs and workflow state before "
                "taking recovery action."
            )

        elif job_status in {"failed", "stopped", "canceled", "cancelled"}:
            finding = "queue_failed"
            recommendation = (
                "RQ reports a failed or stopped job. Inspect its exception "
                "and workflow checkpoints before retrying."
            )

        elif job_status == "untracked":
            finding = "untracked"
            recommendation = (
                "No persisted RQ job ID is available. Do not automatically "
                "resubmit this workflow."
            )

        elif job_status == "unknown":
            finding = "inspection_failed"
            recommendation = (
                "RQ job status could not be determined. Check Redis "
                "connectivity before deciding whether to resubmit."
            )

        else:
            finding = "queue_missing"
            recommendation = (
                "The recorded RQ job could not be found. Verify Redis "
                "and job retention before considering recovery."
            )

        if age is not None and age > stale_seconds and finding == "queued":
            finding = "queued_too_long"
            recommendation = (
                "Workflow has remained queued beyond the stale threshold. "
                "Check worker health and queue backlog."
            )

    elif workflow_status == "running":
        if job_status == "started":
            finding = "running"
            recommendation = (
                "RQ reports an active worker. Do not retry this workflow."
            )

        elif job_status == "finished":
            finding = "completion_mismatch"
            recommendation = (
                "RQ reports a finished job but the database still says "
                "running. Inspect the worker's final database commit."
            )

        elif job_status in {"failed", "stopped", "canceled", "cancelled"}:
            finding = "worker_terminated"
            recommendation = (
                "RQ reports a terminated job while the workflow remains "
                "running. Inspect the last checkpoint and worker exception."
            )

        elif job_status == "queued":
            finding = "running_queue_mismatch"
            recommendation = (
                "Database says running but RQ reports queued. Inspect "
                "worker attempt ownership before taking action."
            )

        elif job_status == "untracked":
            finding = "running_untracked"
            recommendation = (
                "No persisted RQ job ID is available. Use worker logs "
                "and checkpoints to investigate this workflow."
            )

        else:
            finding = "running_inspection_failed"
            recommendation = (
                "Unable to determine the RQ execution state. Verify "
                "Redis availability and inspect worker health."
            )

        if age is not None and age > stale_seconds:
            finding = "running_stale"
            recommendation = (
                "Workflow has not updated within the stale threshold. "
                "This is only a suspected stale execution; verify worker "
                "health and attempt ownership before retrying."
            )

    else:
        finding = "unknown_workflow_status"
        recommendation = (
            "Workflow has an unrecognized status. Inspect its database "
            "record before making changes."
        )

    return {
        "workflow_id": run.id,
        "user_id": run.user_id,
        "workflow_type": run.workflow_type,
        "workflow_status": workflow_status,
        "queue_job_id": getattr(run, "rq_job_id", "") or "",
        "queue_status": job_status,
        "finding": finding,
        "attempt_count": run.attempt_count,
        "max_attempts": run.max_attempts,
        "current_step": run.current_step,
        "updated_at": (
            _utc(run.updated_at).isoformat()
            if run.updated_at else None
        ),
        "age_seconds": age,
        "recommendation": recommendation,
    }


def inspect_agent_workflows(
    db: Session,
    *,
    user_id: str | None = None,
    stale_after_minutes: int = DEFAULT_STALE_MINUTES,
    limit: int = 100,
) -> dict[str, Any]:
    """
    Inspect persisted agent workflows against their RQ jobs.

    Args:
        db:
            Existing SQLAlchemy session.
        user_id:
            Optional user scope. If omitted, all users are inspected.
            Only use global scope from a protected administrative job.
        stale_after_minutes:
            Age threshold for suspected stale workflows.
        limit:
            Maximum number of database records inspected.

    Returns:
        A diagnostic report. No database or queue mutations are made.

    Important:
        This service expects the rq_job_id model column to exist.
        Until migration 0046 is applied, records without that field are
        reported as untracked.
    """

    if stale_after_minutes < 1 or stale_after_minutes > 1440:
        raise ValueError(
            "stale_after_minutes must be between 1 and 1440."
        )

    if limit < 1 or limit > MAX_SCAN_LIMIT:
        raise ValueError(
            f"limit must be between 1 and {MAX_SCAN_LIMIT}."
        )

    statement = (
        select(AgentWorkflowRun)
        .where(
            AgentWorkflowRun.status.in_(
                list(ACTIVE_WORKFLOW_STATUSES)
            )
        )
        .order_by(
            AgentWorkflowRun.updated_at.asc()
        )
        .limit(limit)
    )

    if user_id is not None:
        statement = statement.where(
            AgentWorkflowRun.user_id == user_id
        )

    runs = db.scalars(statement).all()

    try:
        queue = get_queue()
    except Exception as exc:
        logger.warning(
            "Queue reconciliation could not connect to RQ: %s",
            type(exc).__name__,
        )

        return {
            "dry_run": True,
            "mutations_performed": False,
            "queue_available": False,
            "scanned": len(runs),
            "findings": [],
            "summary": {
                "queue_unavailable": len(runs),
            },
            "error": (
                "RQ queue is unavailable. No workflow status was changed."
            ),
        }

    findings = []

    for run in runs:
        job_id = getattr(run, "rq_job_id", "") or ""

        job_info = (
            _job_status(queue, job_id)
            if job_id
            else {
                "exists": False,
                "status": "untracked",
                "error": None,
            }
        )

        findings.append(
            _classify_workflow(
                run,
                job_info,
                stale_after_minutes,
            )
        )

    summary: dict[str, int] = {}

    for finding in findings:
        key = finding["finding"]
        summary[key] = summary.get(key, 0) + 1

    return {
        "dry_run": True,
        "mutations_performed": False,
        "queue_available": True,
        "scanned": len(runs),
        "stale_after_minutes": stale_after_minutes,
        "findings": findings,
        "summary": summary,
    }

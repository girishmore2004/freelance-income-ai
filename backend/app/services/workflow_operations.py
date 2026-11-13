
"""Deterministic operational helpers for durable workflows."""

from collections import Counter
import json
from functools import wraps


def classify_workflow_error(exc):
    message = str(exc).lower()

    if "superseded" in message or "stale checkpoint" in message:
        return "WORKER_SUPERSEDED"

    if "cancelled" in message:
        return "WORKFLOW_CANCELLED"

    if "timeout" in message or "timed out" in message:
        return "AGENT_TIMEOUT"

    if "redis" in message or "queue" in message:
        return "QUEUE_UNAVAILABLE"

    if "database" in message or "sqlalchemy" in message or "connection" in message:
        return "DATABASE_ERROR"

    return "WORKFLOW_EXECUTION_ERROR"


def ensure_workflow_attempt_active(state):
    """
    Verify that the workflow is still owned by this execution attempt.

    This check runs before every guarded agent stage. It prevents a
    cancelled or superseded worker from starting additional stages.

    States without workflow execution metadata are intentionally allowed.
    This preserves compatibility with standalone graph tests and
    non-durable graph execution.
    """
    workflow_id = state.get("workflow_id")
    user_id = state.get("user_id")
    execution_attempt = state.get("execution_attempt")

    if not workflow_id or not user_id or execution_attempt is None:
        return

    # Local imports avoid introducing module-level import cycles.
    from ..database import SessionLocal
    from ..models import AgentWorkflowRun
    from sqlalchemy import select

    db = SessionLocal()

    try:
        run = db.scalar(
            select(AgentWorkflowRun).where(
                AgentWorkflowRun.id == workflow_id,
                AgentWorkflowRun.user_id == user_id,
            )
        )

        if not run:
            raise RuntimeError(
                "Agent workflow no longer exists; worker execution stopped."
            )

        if run.status == "cancelled":
            raise RuntimeError(
                "Workflow cancelled; worker execution stopped."
            )

        if run.status != "running":
            raise RuntimeError(
                "Workflow is no longer running; worker execution stopped."
            )

        if run.attempt_count != execution_attempt:
            raise RuntimeError(
                "Worker attempt superseded; stale execution stopped."
            )

    finally:
        db.close()


def summarize_workflow_runs(runs):
    counts = Counter()
    agent_counts = Counter()
    durations = []

    for run in runs:
        counts[run.status or "unknown"] += 1

        try:
            result = json.loads(run.result_json or "{}")
        except (TypeError, ValueError):
            result = {}

        for item in result.get("agent_trace", []):
            agent_counts[item.get("agent", "unknown")] += 1

            value = item.get("duration_ms")

            if isinstance(value, (int, float)) and value >= 0:
                durations.append(value)

    return {
        "total": len(runs),
        "status_counts": dict(counts),
        "agent_execution_counts": dict(agent_counts),
        "mean_agent_duration_ms": (
            round(sum(durations) / len(durations), 2)
            if durations else None
        ),
        "measured_agent_steps": len(durations),
        "scope": (
            "Authenticated user's latest 200 runs; "
            "latency uses completed trace steps only."
        ),
    }


def guard_node(node_name, node_fn, on_failure=None):
    """
    Wrap a graph node with execution fencing and failure telemetry.

    The original exception is always preserved. Telemetry failures must
    never hide the actual agent error.
    """

    @wraps(node_fn)
    def wrapped(state):
        try:
            ensure_workflow_attempt_active(state)
            return node_fn(state)

        except Exception as exc:
            if on_failure:
                try:
                    on_failure(state, node_name, exc)
                except Exception:
                    pass

            raise

    return wrapped

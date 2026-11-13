"""Deterministic operational helpers for durable workflows."""
from collections import Counter
import json
from functools import wraps

def classify_workflow_error(exc):
    message = str(exc).lower()
    if "superseded" in message or "stale checkpoint" in message:
        return "WORKER_SUPERSEDED"
    if "timeout" in message or "timed out" in message:
        return "AGENT_TIMEOUT"
    if "redis" in message or "queue" in message:
        return "QUEUE_UNAVAILABLE"
    if "database" in message or "sqlalchemy" in message or "connection" in message:
        return "DATABASE_ERROR"
    return "WORKFLOW_EXECUTION_ERROR"

def summarize_workflow_runs(runs):
    counts, agent_counts, durations = Counter(), Counter(), []
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
        "total": len(runs), "status_counts": dict(counts),
        "agent_execution_counts": dict(agent_counts),
        "mean_agent_duration_ms": round(sum(durations) / len(durations), 2) if durations else None,
        "measured_agent_steps": len(durations),
        "scope": "Authenticated user's latest 200 runs; latency uses completed trace steps only.",
    }


def guard_node(node_name, node_fn, on_failure=None):
    """Wrap a graph node so its failing stage is observable before the error bubbles up."""
    @wraps(node_fn)
    def wrapped(state):
        try:
            return node_fn(state)
        except Exception as exc:
            if on_failure:
                try:
                    on_failure(state, node_name, exc)
                except Exception:
                    # Failure telemetry must never hide the original agent exception.
                    pass
            raise
    return wrapped

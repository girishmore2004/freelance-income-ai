from types import SimpleNamespace
from app.services.workflow_operations import classify_workflow_error, summarize_workflow_runs

def test_error_classification_is_stable():
    assert classify_workflow_error(RuntimeError("worker attempt superseded")) == "WORKER_SUPERSEDED"
    assert classify_workflow_error(TimeoutError("model timed out")) == "AGENT_TIMEOUT"
    assert classify_workflow_error(RuntimeError("redis queue unavailable")) == "QUEUE_UNAVAILABLE"
    assert classify_workflow_error(RuntimeError("unexpected issue")) == "WORKFLOW_EXECUTION_ERROR"

def test_metrics_summarize_trace_data():
    rows = [
        SimpleNamespace(status="completed", result_json='{"agent_trace":[{"agent":"matching","duration_ms":20},{"agent":"finance","duration_ms":40}]}'),
        SimpleNamespace(status="failed", result_json="{}"),
    ]
    result = summarize_workflow_runs(rows)
    assert result["total"] == 2
    assert result["status_counts"] == {"completed": 1, "failed": 1}
    assert result["mean_agent_duration_ms"] == 30
    assert result["agent_execution_counts"] == {"matching": 1, "finance": 1}

def test_metrics_tolerate_malformed_json():
    row = SimpleNamespace(status="completed", result_json="{")
    assert summarize_workflow_runs([row])["measured_agent_steps"] == 0

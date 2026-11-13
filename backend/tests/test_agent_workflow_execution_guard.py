
import pytest

from app.services.workflow_operations import (
    classify_workflow_error,
    ensure_workflow_attempt_active,
    guard_node,
)


def test_standalone_graph_state_remains_supported():
    ensure_workflow_attempt_active({
        "value": 10,
    })


def test_state_without_execution_attempt_remains_supported():
    ensure_workflow_attempt_active({
        "workflow_id": "workflow-test",
        "user_id": "user-test",
    })


def test_guard_node_executes_normal_node():
    node = guard_node(
        "matching",
        lambda state: {"result": state["value"] * 2},
    )

    assert node({"value": 5}) == {"result": 10}


def test_guard_node_preserves_original_exception():
    events = []

    def failing_node(state):
        raise TimeoutError("agent timeout")

    def record_failure(state, node_name, exc):
        events.append((node_name, type(exc).__name__))

    node = guard_node(
        "matching",
        failing_node,
        record_failure,
    )

    with pytest.raises(TimeoutError, match="agent timeout"):
        node({"value": 1})

    assert events == [("matching", "TimeoutError")]


def test_telemetry_error_does_not_mask_original_exception():
    def failing_node(state):
        raise ValueError("original error")

    def failing_telemetry(*args):
        raise RuntimeError("telemetry error")

    node = guard_node(
        "finance",
        failing_node,
        failing_telemetry,
    )

    with pytest.raises(ValueError, match="original error"):
        node({"value": 1})


def test_cancelled_workflow_error_classification():
    error = RuntimeError("Workflow cancelled; worker execution stopped.")

    assert classify_workflow_error(error) == "WORKFLOW_CANCELLED"


def test_superseded_worker_error_classification():
    error = RuntimeError("Worker attempt superseded.")

    assert classify_workflow_error(error) == "WORKER_SUPERSEDED"


def test_timeout_error_classification():
    error = TimeoutError("Agent timed out")

    assert classify_workflow_error(error) == "AGENT_TIMEOUT"

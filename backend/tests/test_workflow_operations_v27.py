import pytest
from app.services.workflow_operations import guard_node


def test_guard_node_returns_normal_node_result():
    node = guard_node("matching", lambda state: {"done": state["value"]})
    assert node({"value": 3}) == {"done": 3}


def test_guard_node_records_failure_and_preserves_original_exception():
    events = []
    def fail(state):
        raise TimeoutError("agent timeout")
    def record(state, node_name, exc):
        events.append((node_name, type(exc).__name__, str(exc)))
    wrapped = guard_node("proposal_strategy", fail, record)
    with pytest.raises(TimeoutError, match="agent timeout"):
        wrapped({"workflow_id": "wf-1"})
    assert events == [("proposal_strategy", "TimeoutError", "agent timeout")]


def test_guard_node_telemetry_failure_does_not_mask_original():
    def fail(state):
        raise ValueError("original")
    def broken_telemetry(*args):
        raise RuntimeError("telemetry failed")
    wrapped = guard_node("finance", fail, broken_telemetry)
    with pytest.raises(ValueError, match="original"):
        wrapped({})

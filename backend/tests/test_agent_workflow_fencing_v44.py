"""Regression tests for stale worker execution fencing."""
import pytest

from app import agent_workflow_engine


class FakeRun:
    id = "workflow-1"
    user_id = "user-1"
    status = "running"
    attempt_count = 3


class FakeSession:
    def __init__(self, run):
        self.run = run
        self.rolled_back = False
        self.committed = False
        self.closed = False

    def scalar(self, statement):
        return self.run

    def add(self, item):
        raise AssertionError("A superseded worker must not write a checkpoint")

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


def test_checkpoint_rejects_superseded_worker_attempt(monkeypatch):
    session = FakeSession(FakeRun())
    monkeypatch.setattr(agent_workflow_engine, "SessionLocal", lambda: session)

    state = {
        "workflow_id": "workflow-1",
        "user_id": "user-1",
        "execution_attempt": 2,  # DB says attempt 3 owns this run now.
        "agent_trace": [],
    }

    with pytest.raises(RuntimeError, match="superseded"):
        agent_workflow_engine._checkpoint(state, "test_node", {"result": {"ok": True}})

    assert session.rolled_back is True
    assert session.committed is False
    assert session.closed is True

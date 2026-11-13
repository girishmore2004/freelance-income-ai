
"""Tests for read-only agent workflow queue reconciliation."""

from datetime import datetime, timezone, timedelta
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.services import queue_reconciliation as service


class FakeDatabase:
    """Minimal SQLAlchemy session substitute for reconciliation tests."""

    def __init__(self, runs):
        self.runs = runs
        self.statement = None

    def scalars(self, statement):
        self.statement = statement
        return SimpleNamespace(all=lambda: self.runs)


class FakeQueue:
    def __init__(self):
        self.connection = Mock()


class FakeRQJob:
    def __init__(self, status):
        self.status = status

    def get_status(self, refresh=True):
        return self.status


def make_workflow(
    *,
    workflow_id="workflow-123",
    user_id="user-123",
    status="queued",
    queue_job_id="rq-job-123",
    updated_at=None,
    attempt_count=1,
    max_attempts=3,
):
    if updated_at is None:
        updated_at = datetime.now(timezone.utc)

    return SimpleNamespace(
        id=workflow_id,
        user_id=user_id,
        workflow_type="business_review",
        status=status,
        current_step="queued",
        rq_job_id=queue_job_id,
        attempt_count=attempt_count,
        max_attempts=max_attempts,
        updated_at=updated_at,
    )


@pytest.fixture
def fake_queue(monkeypatch):
    queue = FakeQueue()

    monkeypatch.setattr(
        service,
        "get_queue",
        lambda: queue,
    )

    return queue


def test_queued_workflow_with_queued_rq_job_is_reported_healthy(
    monkeypatch,
    fake_queue,
):
    run = make_workflow(status="queued")

    monkeypatch.setattr(
        service.Job,
        "fetch",
        lambda job_id, connection: FakeRQJob("queued"),
    )

    db = FakeDatabase([run])

    result = service.inspect_agent_workflows(db)

    assert result["dry_run"] is True
    assert result["mutations_performed"] is False
    assert result["queue_available"] is True
    assert result["scanned"] == 1
    assert result["findings"][0]["finding"] == "queued"
    assert result["findings"][0]["queue_status"] == "queued"


def test_running_workflow_with_started_job_is_reported_running(
    monkeypatch,
    fake_queue,
):
    run = make_workflow(
        status="running",
        updated_at=datetime.now(timezone.utc),
    )

    monkeypatch.setattr(
        service.Job,
        "fetch",
        lambda job_id, connection: FakeRQJob("started"),
    )

    result = service.inspect_agent_workflows(
        FakeDatabase([run])
    )

    assert result["findings"][0]["finding"] == "running"
    assert result["findings"][0]["queue_status"] == "started"


def test_stale_running_workflow_is_flagged_without_mutation(
    monkeypatch,
    fake_queue,
):
    old_time = datetime.now(timezone.utc) - timedelta(minutes=45)

    run = make_workflow(
        status="running",
        updated_at=old_time,
    )

    monkeypatch.setattr(
        service.Job,
        "fetch",
        lambda job_id, connection: FakeRQJob("started"),
    )

    result = service.inspect_agent_workflows(
        FakeDatabase([run]),
        stale_after_minutes=20,
    )

    assert result["findings"][0]["finding"] == "running_stale"
    assert result["mutations_performed"] is False

    # Reconciliation must never alter the source workflow.
    assert run.status == "running"
    assert run.updated_at == old_time


def test_workflow_without_persisted_queue_id_is_untracked(
    monkeypatch,
    fake_queue,
):
    run = make_workflow(
        status="queued",
        queue_job_id="",
    )

    fetch = Mock()

    monkeypatch.setattr(
        service.Job,
        "fetch",
        fetch,
    )

    result = service.inspect_agent_workflows(
        FakeDatabase([run])
    )

    assert result["findings"][0]["finding"] == "untracked"
    assert result["findings"][0]["queue_status"] == "untracked"
    fetch.assert_not_called()


def test_failed_rq_job_is_reported_for_queued_workflow(
    monkeypatch,
    fake_queue,
):
    run = make_workflow(status="queued")

    monkeypatch.setattr(
        service.Job,
        "fetch",
        lambda job_id, connection: FakeRQJob("failed"),
    )

    result = service.inspect_agent_workflows(
        FakeDatabase([run])
    )

    assert result["findings"][0]["finding"] == "queue_failed"


def test_finished_rq_job_with_running_database_state_is_mismatch(
    monkeypatch,
    fake_queue,
):
    run = make_workflow(status="running")

    monkeypatch.setattr(
        service.Job,
        "fetch",
        lambda job_id, connection: FakeRQJob("finished"),
    )

    result = service.inspect_agent_workflows(
        FakeDatabase([run])
    )

    assert result["findings"][0]["finding"] == "completion_mismatch"


def test_redis_unavailable_returns_safe_diagnostic(
    monkeypatch,
):
    run = make_workflow()

    def unavailable_queue():
        raise RuntimeError("Redis unavailable")

    monkeypatch.setattr(
        service,
        "get_queue",
        unavailable_queue,
    )

    result = service.inspect_agent_workflows(
        FakeDatabase([run])
    )

    assert result["dry_run"] is True
    assert result["mutations_performed"] is False
    assert result["queue_available"] is False
    assert result["scanned"] == 1
    assert result["findings"] == []


def test_invalid_stale_threshold_is_rejected():
    with pytest.raises(ValueError, match="stale_after_minutes"):
        service.inspect_agent_workflows(
            FakeDatabase([]),
            stale_after_minutes=0,
        )


def test_invalid_scan_limit_is_rejected():
    with pytest.raises(ValueError, match="limit"):
        service.inspect_agent_workflows(
            FakeDatabase([]),
            limit=10000,
        )


def test_user_scope_is_applied_to_database_query(
    monkeypatch,
    fake_queue,
):
    db = FakeDatabase([])

    monkeypatch.setattr(
        service.Job,
        "fetch",
        Mock(),
    )

    result = service.inspect_agent_workflows(
        db,
        user_id="user-456",
    )

    assert result["scanned"] == 0

    # The generated SQL statement must include the user filter.
    compiled = str(db.statement)
    assert "user_id" in compiled

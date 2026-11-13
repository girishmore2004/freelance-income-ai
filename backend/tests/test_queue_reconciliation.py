from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from rq.exceptions import NoSuchJobError

from app.services import queue_reconciliation as service


class FakeRQJob:
    def __init__(self, status="queued"):
        self.status = status

    def get_status(self, refresh=True):
        return self.status


class FakeQueue:
    def __init__(self, connection=None):
        self.connection = connection or object()


class FakeQuery:
    def __init__(self, rows):
        self.rows = rows

    def filter(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def limit(self, count):
        self.rows = self.rows[:count]
        return self

    def all(self):
        return self.rows


class FakeDatabase:
    def __init__(self, rows):
        self.rows = rows

    def query(self, model):
        return FakeQuery(self.rows)


def make_run(
    *,
    run_id="run-1",
    user_id="user-1",
    rq_job_id="job-1",
    status="queued",
    created_minutes_ago=1,
    started_minutes_ago=None,
):
    now = datetime.now(timezone.utc)

    started_at = None
    if started_minutes_ago is not None:
        started_at = now - timedelta(minutes=started_minutes_ago)

    return SimpleNamespace(
        id=run_id,
        user_id=user_id,
        rq_job_id=rq_job_id,
        status=status,
        current_step="queued",
        created_at=now - timedelta(minutes=created_minutes_ago),
        started_at=started_at,
        updated_at=now,
        finished_at=None,
        attempt_count=0,
        max_attempts=3,
        error_message="",
    )


@pytest.fixture
def queue(monkeypatch):
    fake_queue = FakeQueue()
    monkeypatch.setattr(service, "get_queue", lambda: fake_queue)
    return fake_queue


def get_findings(report):
    """Return findings from the inspection report."""
    assert isinstance(report, dict)
    assert "findings" in report
    return report["findings"]


def get_issue_types(report):
    """Extract issue identifiers without depending on display text."""
    findings = get_findings(report)
    return {
        item.get("issue") or item.get("classification") or item.get("type")
        for item in findings
    }


def test_missing_rq_job_is_classified_as_missing(monkeypatch, queue):
    run = make_run(rq_job_id="missing-job")
    db = FakeDatabase([run])

    def missing_job(job_id, connection=None):
        raise NoSuchJobError(job_id)

    monkeypatch.setattr(service.Job, "fetch", missing_job)

    report = service.inspect_agent_workflows(
        db,
        user_id="user-1",
    )

    assert "queue_missing" in get_issue_types(report)


def test_redis_connection_failure_is_not_classified_as_missing(
    monkeypatch,
    queue,
):
    run = make_run(rq_job_id="job-connection-error")
    db = FakeDatabase([run])

    def redis_failure(job_id, connection=None):
        raise ConnectionError("Redis is unavailable")

    monkeypatch.setattr(service.Job, "fetch", redis_failure)

    report = service.inspect_agent_workflows(
        db,
        user_id="user-1",
    )

    issue_types = get_issue_types(report)

    assert "queue_missing" not in issue_types
    assert "inspection_failed" in issue_types or "unknown" in issue_types


def test_existing_queued_job_is_not_reported_as_missing(
    monkeypatch,
    queue,
):
    run = make_run(rq_job_id="existing-queued-job")
    db = FakeDatabase([run])

    monkeypatch.setattr(
        service.Job,
        "fetch",
        lambda job_id, connection=None: FakeRQJob("queued"),
    )

    report = service.inspect_agent_workflows(
        db,
        user_id="user-1",
    )

    assert "queue_missing" not in get_issue_types(report)


def test_running_workflow_with_missing_job_is_reported(
    monkeypatch,
    queue,
):
    run = make_run(
        rq_job_id="missing-running-job",
        status="running",
        started_minutes_ago=30,
    )
    db = FakeDatabase([run])

    def missing_job(job_id, connection=None):
        raise NoSuchJobError(job_id)

    monkeypatch.setattr(service.Job, "fetch", missing_job)

    report = service.inspect_agent_workflows(
        db,
        user_id="user-1",
    )

    issue_types = get_issue_types(report)

    assert (
        "running_job_missing" in issue_types
        or "queue_missing" in issue_types
        or "running_stale" in issue_types
    )


def test_workflow_without_rq_job_id_is_reported_as_untracked(
    monkeypatch,
    queue,
):
    run = make_run(rq_job_id="")
    db = FakeDatabase([run])

    report = service.inspect_agent_workflows(
        db,
        user_id="user-1",
    )

    assert "untracked" in get_issue_types(report)


def test_stale_queued_workflow_is_detected(monkeypatch, queue):
    run = make_run(
        rq_job_id="stale-queued-job",
        status="queued",
        created_minutes_ago=60,
    )
    db = FakeDatabase([run])

    monkeypatch.setattr(
        service.Job,
        "fetch",
        lambda job_id, connection=None: FakeRQJob("queued"),
    )

    report = service.inspect_agent_workflows(
        db,
        user_id="user-1",
        stale_after_minutes=20,
    )

    issue_types = get_issue_types(report)

    assert (
        "queued_too_long" in issue_types
        or "stale_queued" in issue_types
    )


def test_stale_running_workflow_is_detected(monkeypatch, queue):
    run = make_run(
        rq_job_id="stale-running-job",
        status="running",
        started_minutes_ago=60,
    )
    db = FakeDatabase([run])

    monkeypatch.setattr(
        service.Job,
        "fetch",
        lambda job_id, connection=None: FakeRQJob("started"),
    )

    report = service.inspect_agent_workflows(
        db,
        user_id="user-1",
        stale_after_minutes=20,
    )

    issue_types = get_issue_types(report)

    assert (
        "running_stale" in issue_types
        or "stale_running" in issue_types
    )


def test_inspection_does_not_mutate_workflow_records(
    monkeypatch,
    queue,
):
    run = make_run(
        rq_job_id="read-only-job",
        status="queued",
    )
    original_status = run.status
    original_attempt_count = run.attempt_count
    original_error_message = run.error_message

    db = FakeDatabase([run])

    monkeypatch.setattr(
        service.Job,
        "fetch",
        lambda job_id, connection=None: FakeRQJob("queued"),
    )

    service.inspect_agent_workflows(
        db,
        user_id="user-1",
    )

    assert run.status == original_status
    assert run.attempt_count == original_attempt_count
    assert run.error_message == original_error_message


def test_inspection_respects_requested_limit(monkeypatch, queue):
    rows = [
        make_run(
            run_id=f"run-{index}",
            rq_job_id=f"job-{index}",
        )
        for index in range(5)
    ]
    db = FakeDatabase(rows)

    monkeypatch.setattr(
        service.Job,
        "fetch",
        lambda job_id, connection=None: FakeRQJob("queued"),
    )

    report = service.inspect_agent_workflows(
        db,
        user_id="user-1",
        limit=2,
    )

    assert report.get("checked", 0) <= 2


def test_inspection_handles_queue_initialization_failure(monkeypatch):
    run = make_run()
    db = FakeDatabase([run])

    def queue_failure():
        raise ConnectionError("Cannot connect to Redis")

    monkeypatch.setattr(service, "get_queue", queue_failure)

    report = service.inspect_agent_workflows(
        db,
        user_id="user-1",
    )

    assert isinstance(report, dict)
    assert report.get("queue_available") is False

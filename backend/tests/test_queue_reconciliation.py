"""Tests for read-only RQ workflow queue reconciliation."""

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
    def __init__(self):
        self.connection = object()


class FakeScalarResult:
    def __init__(self, rows):
        self.rows = rows

    def all(self):
        return list(self.rows)


class FakeDatabase:
    """Small SQLAlchemy Session substitute for service unit tests."""

    def __init__(self, rows):
        self.rows = rows
        self.last_statement = None

    def scalars(self, statement):
        self.last_statement = statement
        rows = list(self.rows)

        # Respect SQLAlchemy's LIMIT clause when one is present.
        limit_clause = getattr(statement, "_limit_clause", None)
        limit_value = getattr(limit_clause, "value", None)

        if isinstance(limit_value, int):
            rows = rows[:limit_value]

        return FakeScalarResult(rows)


def make_run(
    *,
    run_id="run-1",
    user_id="user-1",
    rq_job_id="job-1",
    workflow_type="business_review",
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
        workflow_type=workflow_type,
        rq_job_id=rq_job_id,
        status=status,
        current_step="queued",
        state_json="{}",
        result_json="{}",
        error_message="",
        attempt_count=0,
        max_attempts=3,
        created_at=now - timedelta(minutes=created_minutes_ago),
        started_at=started_at,
        updated_at=now,
        finished_at=None,
    )


@pytest.fixture
def fake_queue(monkeypatch):
    queue = FakeQueue()
    monkeypatch.setattr(service, "get_queue", lambda: queue)
    return queue


def get_findings(report):
    assert isinstance(report, dict)
    assert "findings" in report
    return report["findings"]


def get_issue_types(report):
    return {
        item.get("issue") or item.get("classification") or item.get("type")
        for item in get_findings(report)
    }


def test_missing_rq_job_is_classified_as_missing(monkeypatch, fake_queue):
    db = FakeDatabase([make_run(rq_job_id="missing-job")])

    def missing_job(job_id, connection=None):
        raise NoSuchJobError(job_id)

    monkeypatch.setattr(service.Job, "fetch", missing_job)

    report = service.inspect_agent_workflows(db, user_id="user-1")

    assert "queue_missing" in get_issue_types(report)


def test_redis_failure_is_not_classified_as_missing(
    monkeypatch,
    fake_queue,
):
    db = FakeDatabase([make_run(rq_job_id="connection-error-job")])

    def redis_failure(job_id, connection=None):
        raise ConnectionError("Redis is unavailable")

    monkeypatch.setattr(service.Job, "fetch", redis_failure)

    report = service.inspect_agent_workflows(db, user_id="user-1")
    issue_types = get_issue_types(report)

    assert "queue_missing" not in issue_types
    assert (
        "inspection_failed" in issue_types
        or "unknown" in issue_types
    )


def test_existing_queued_job_is_not_reported_as_missing(
    monkeypatch,
    fake_queue,
):
    db = FakeDatabase([make_run(rq_job_id="existing-job")])

    monkeypatch.setattr(
        service.Job,
        "fetch",
        lambda job_id, connection=None: FakeRQJob("queued"),
    )

    report = service.inspect_agent_workflows(db, user_id="user-1")

    assert "queue_missing" not in get_issue_types(report)


def test_running_workflow_with_missing_job_is_reported(
    monkeypatch,
    fake_queue,
):
    db = FakeDatabase(
        [
            make_run(
                rq_job_id="missing-running-job",
                status="running",
                started_minutes_ago=30,
            )
        ]
    )

    def missing_job(job_id, connection=None):
        raise NoSuchJobError(job_id)

    monkeypatch.setattr(service.Job, "fetch", missing_job)

    report = service.inspect_agent_workflows(db, user_id="user-1")
    issue_types = get_issue_types(report)

    assert (
        "running_job_missing" in issue_types
        or "queue_missing" in issue_types
        or "running_stale" in issue_types
    )


def test_workflow_without_rq_job_id_is_reported_as_untracked(
    fake_queue,
):
    db = FakeDatabase([make_run(rq_job_id="")])

    report = service.inspect_agent_workflows(db, user_id="user-1")

    assert "untracked" in get_issue_types(report)


def test_stale_queued_workflow_is_detected(monkeypatch, fake_queue):
    db = FakeDatabase(
        [
            make_run(
                rq_job_id="stale-queued-job",
                status="queued",
                created_minutes_ago=60,
            )
        ]
    )

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


def test_stale_running_workflow_is_detected(monkeypatch, fake_queue):
    db = FakeDatabase(
        [
            make_run(
                rq_job_id="stale-running-job",
                status="running",
                started_minutes_ago=60,
            )
        ]
    )

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
    fake_queue,
):
    run = make_run(rq_job_id="read-only-job")
    db = FakeDatabase([run])

    original_status = run.status
    original_attempt_count = run.attempt_count
    original_error_message = run.error_message

    monkeypatch.setattr(
        service.Job,
        "fetch",
        lambda job_id, connection=None: FakeRQJob("queued"),
    )

    service.inspect_agent_workflows(db, user_id="user-1")

    assert run.status == original_status
    assert run.attempt_count == original_attempt_count
    assert run.error_message == original_error_message


def test_inspection_respects_requested_limit(monkeypatch, fake_queue):
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


def test_user_filter_is_included_in_sql_statement(
    monkeypatch,
    fake_queue,
):
    db = FakeDatabase([make_run(user_id="user-1")])

    monkeypatch.setattr(
        service.Job,
        "fetch",
        lambda job_id, connection=None: FakeRQJob("queued"),
    )

    service.inspect_agent_workflows(db, user_id="user-1")

    assert db.last_statement is not None
    assert "agent_workflow_runs.user_id" in str(db.last_statement)


def test_queue_initialization_failure_returns_unavailable_report(
    monkeypatch,
):
    db = FakeDatabase([make_run()])

    def queue_failure():
        raise ConnectionError("Cannot connect to Redis")

    monkeypatch.setattr(service, "get_queue", queue_failure)

    report = service.inspect_agent_workflows(db, user_id="user-1")

    assert isinstance(report, dict)
    assert report.get("queue_available") is False

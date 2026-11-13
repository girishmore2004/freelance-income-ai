"""Tests for idempotent RQ job submission."""

from unittest.mock import Mock, patch

import pytest
from rq.exceptions import NoSuchJobError

from app.services.rq_submission import enqueue_once


@pytest.fixture
def fake_queue():
    queue = Mock()
    queue.connection = Mock(name="redis_connection")
    return queue


def test_enqueue_once_enqueues_when_job_does_not_exist(fake_queue):
    expected_job = Mock(id="agent-workflow-test-attempt-1")

    with (
        patch("app.services.rq_submission.get_queue", return_value=fake_queue),
        patch("app.services.rq_submission.Job.fetch") as fetch_job,
    ):
        fetch_job.side_effect = lambda job_id, connection=None: (
            (_ for _ in ()).throw(NoSuchJobError(job_id))
        )
        fake_queue.enqueue.return_value = expected_job

        result = enqueue_once(
            "app.agent_workflow_engine.run_agent_workflow",
            "workflow-123",
            "user-123",
            job_id="agent-workflow-test-attempt-1",
        )

    assert result is expected_job
    fetch_job.assert_called_once_with(
        "agent-workflow-test-attempt-1",
        connection=fake_queue.connection,
    )
    fake_queue.enqueue.assert_called_once_with(
        "app.agent_workflow_engine.run_agent_workflow",
        "workflow-123",
        "user-123",
        job_id="agent-workflow-test-attempt-1",
    )


def test_enqueue_once_returns_existing_job_without_enqueuing(fake_queue):
    existing_job = Mock(id="agent-workflow-test-attempt-1")

    with (
        patch("app.services.rq_submission.get_queue", return_value=fake_queue),
        patch(
            "app.services.rq_submission.Job.fetch",
            return_value=existing_job,
        ) as fetch_job,
    ):
        result = enqueue_once(
            "app.agent_workflow_engine.run_agent_workflow",
            "workflow-123",
            "user-123",
            job_id="agent-workflow-test-attempt-1",
        )

    assert result is existing_job
    fetch_job.assert_called_once_with(
        "agent-workflow-test-attempt-1",
        connection=fake_queue.connection,
    )
    fake_queue.enqueue.assert_not_called()


def test_enqueue_once_propagates_unexpected_fetch_errors(fake_queue):
    with (
        patch("app.services.rq_submission.get_queue", return_value=fake_queue),
        patch(
            "app.services.rq_submission.Job.fetch",
            side_effect=ConnectionError("Redis connection failed"),
        ),
    ):
        with pytest.raises(ConnectionError, match="Redis connection failed"):
            enqueue_once(
                "app.agent_workflow_engine.run_agent_workflow",
                "workflow-123",
                "user-123",
                job_id="agent-workflow-test-attempt-1",
            )

    fake_queue.enqueue.assert_not_called()


def test_enqueue_once_propagates_enqueue_errors(fake_queue):
    fake_queue.enqueue.side_effect = RuntimeError("RQ enqueue failed")

    with (
        patch("app.services.rq_submission.get_queue", return_value=fake_queue),
        patch(
            "app.services.rq_submission.Job.fetch",
            side_effect=NoSuchJobError("agent-workflow-test-attempt-1"),
        ),
    ):
        with pytest.raises(RuntimeError, match="RQ enqueue failed"):
            enqueue_once(
                "app.agent_workflow_engine.run_agent_workflow",
                "workflow-123",
                "user-123",
                job_id="agent-workflow-test-attempt-1",
            )


@pytest.mark.parametrize(
    ("function", "job_id"),
    [
        ("", "valid-job-id"),
        ("app.agent_workflow_engine.run_agent_workflow", ""),
    ],
)
def test_enqueue_once_rejects_invalid_identifiers(function, job_id):
    with pytest.raises(ValueError):
        enqueue_once(
            function,
            "workflow-123",
            "user-123",
            job_id=job_id,
        )

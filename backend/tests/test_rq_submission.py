
from unittest.mock import Mock

import pytest

from app.services import rq_submission


def test_enqueue_once_submits_deterministic_job_id():
    queue = Mock()
    expected_job = Mock(id="agent-workflow-test-attempt-1")
    queue.enqueue.return_value = expected_job

    result = rq_submission.enqueue_once(
        queue,
        "app.agent_workflow_engine.run_agent_workflow",
        "workflow-123",
        "user-123",
        job_id="agent-workflow-test-attempt-1",
        job_timeout=900,
    )

    assert result is expected_job
    queue.enqueue.assert_called_once_with(
        "app.agent_workflow_engine.run_agent_workflow",
        "workflow-123",
        "user-123",
        job_id="agent-workflow-test-attempt-1",
        job_timeout=900,
    )


def test_enqueue_once_recovers_existing_job(monkeypatch):
    queue = Mock()
    queue.enqueue.side_effect = RuntimeError("duplicate job ID")

    existing_job = Mock(id="agent-workflow-test-attempt-1")

    monkeypatch.setattr(
        rq_submission.Job,
        "fetch",
        lambda job_id, connection: existing_job,
    )

    result = rq_submission.enqueue_once(
        queue,
        "app.agent_workflow_engine.run_agent_workflow",
        "workflow-123",
        "user-123",
        job_id="agent-workflow-test-attempt-1",
    )

    assert result is existing_job


def test_enqueue_once_reraises_when_submission_and_recovery_fail(monkeypatch):
    queue = Mock()
    queue.enqueue.side_effect = RuntimeError("Redis unavailable")

    def missing_job(*args, **kwargs):
        raise LookupError("Job does not exist")

    monkeypatch.setattr(
        rq_submission.Job,
        "fetch",
        missing_job,
    )

    with pytest.raises(RuntimeError, match="Redis unavailable"):
        rq_submission.enqueue_once(
            queue,
            "app.agent_workflow_engine.run_agent_workflow",
            "workflow-123",
            "user-123",
            job_id="agent-workflow-test-attempt-1",
        )


@pytest.mark.parametrize("job_id", ["", "x" * 201])
def test_enqueue_once_rejects_invalid_job_id(job_id):
    queue = Mock()

    with pytest.raises(ValueError, match="job_id"):
        rq_submission.enqueue_once(
            queue,
            "app.agent_workflow_engine.run_agent_workflow",
            job_id=job_id,
        )

    queue.enqueue.assert_not_called()

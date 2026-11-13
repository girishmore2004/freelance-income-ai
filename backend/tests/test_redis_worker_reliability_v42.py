"""Redis/RQ integration tests for v4.2.

These tests use the ephemeral Redis service configured by full CI. They never
call external AI providers, email providers or marketplaces.
"""
import os
import uuid

import pytest
from fastapi.testclient import TestClient
from redis import Redis
from redis.exceptions import ConnectionError as RedisConnectionError
from rq import Queue, SimpleWorker

import app.main as main
from app.routers import agent_workflows


REDIS_URL = os.getenv("TEST_REDIS_URL", "")
pytestmark = pytest.mark.skipif(not REDIS_URL, reason="TEST_REDIS_URL is not configured")
client = TestClient(main.app)


def _sum_values(left, right):
    return left + right


def _auth():
    email = f"redis-v42-{uuid.uuid4().hex}@example.test"
    response = client.post("/api/v1/auth/register", json={
        "email": email, "password": "StrongPassword123!"
    })
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}, email


def _queue_job(job_id):
    connection = Redis.from_url(REDIS_URL)
    return Queue("freelance-income-ai", connection=connection).fetch_job(job_id)


def test_redis_connection_and_rq_worker_execute_a_real_queued_job():
    connection = Redis.from_url(REDIS_URL)
    assert connection.ping() is True

    queue_name = "fia-v42-smoke-" + uuid.uuid4().hex
    queue = Queue(queue_name, connection=connection, default_timeout=30)
    job = queue.enqueue(_sum_values, 19, 23, result_ttl=300)
    try:
        worker = SimpleWorker([queue], connection=connection)
        worker.work(burst=True, logging_level="WARNING")
        job.refresh()
        assert job.is_finished
        assert job.result == 42
    finally:
        try:
            job.delete(remove_from_queue=True)
        except Exception:
            pass
        try:
            queue.empty()
        except Exception:
            pass
        connection.close()


def test_agent_workflow_enqueue_is_idempotent_and_job_is_visible_in_redis():
    headers, email = _auth()
    key = "v42-" + uuid.uuid4().hex
    first = client.post("/api/v1/agent-workflows", headers=headers, json={
        "workflow_type": "delivery_review", "idempotency_key": key
    })
    assert first.status_code == 200, first.text
    payload = first.json()
    assert payload["status"] == "queued"
    assert payload["queue_job_id"]

    second = client.post("/api/v1/agent-workflows", headers=headers, json={
        "workflow_type": "delivery_review", "idempotency_key": key
    })
    assert second.status_code == 200, second.text
    assert second.json()["idempotent_replay"] is True

    job = _queue_job(payload["queue_job_id"])
    assert job is not None
    assert job.func_name == "app.agent_workflow_engine.run_agent_workflow"
    assert job.args[0] == payload["workflow_id"]
    from sqlalchemy import select
    from app.database import SessionLocal
    from app.models import User
    with SessionLocal() as db:
        owner = db.scalar(select(User).where(User.email == email))
        assert job.args[1] == owner.id
    try:
        job.delete(remove_from_queue=True)
    except Exception:
        pass


def test_queue_outage_marks_run_failed_and_retry_recovers_after_redis_returns(monkeypatch):
    headers, email = _auth()
    key = "v42-recovery-" + uuid.uuid4().hex

    def unavailable_queue():
        raise RedisConnectionError("simulated Redis outage")

    monkeypatch.setattr(agent_workflows, "get_queue", unavailable_queue)
    failed = client.post("/api/v1/agent-workflows", headers=headers, json={
        "workflow_type": "finance_review", "idempotency_key": key
    })
    assert failed.status_code == 503
    detail = failed.json()["detail"]
    assert "queue unavailable" in detail.lower()

    from sqlalchemy import select
    from app.database import SessionLocal
    from app.models import AgentWorkflowRun, User
    with SessionLocal() as db:
        owner = db.scalar(select(User).where(User.email == email))
        failed_run = db.scalar(select(AgentWorkflowRun).where(
            AgentWorkflowRun.idempotency_key == key,
            AgentWorkflowRun.user_id == owner.id,
        ))
        workflow_id = failed_run.id
        assert failed_run.status == "failed"
        assert failed_run.current_step == "queue_failed"

    connection = Redis.from_url(REDIS_URL)
    queue = Queue("freelance-income-ai", connection=connection)
    monkeypatch.setattr(agent_workflows, "get_queue", lambda: queue)
    recovered = client.post(f"/api/v1/agent-workflows/{workflow_id}/retry", headers=headers)
    assert recovered.status_code == 200, recovered.text
    assert recovered.json()["status"] == "queued"
    job = queue.fetch_job(recovered.json()["queue_job_id"])
    assert job is not None
    try:
        job.delete(remove_from_queue=True)
    except Exception:
        pass
    connection.close()


def test_cancelled_queued_workflow_is_a_noop_when_worker_picks_it_up():
    headers, _ = _auth()
    key = "v44-cancel-" + uuid.uuid4().hex
    response = client.post("/api/v1/agent-workflows", headers=headers, json={
        "workflow_type": "delivery_review", "idempotency_key": key
    })
    assert response.status_code == 200, response.text
    workflow_id = response.json()["workflow_id"]
    job_id = response.json()["queue_job_id"]

    cancelled = client.post(
        f"/api/v1/agent-workflows/{workflow_id}/cancel", headers=headers
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"

    # Execute only the queued job wrapper. The engine must observe cancellation
    # before entering the graph and return without invoking any specialist.
    from app.agent_workflow_engine import run_agent_workflow
    connection = Redis.from_url(REDIS_URL)
    queue = Queue("freelance-income-ai", connection=connection)
    job = queue.fetch_job(job_id)
    assert job is not None
    result = run_agent_workflow(workflow_id, job.args[1])
    assert result["status"] == "cancelled"

    from sqlalchemy import select
    from app.database import SessionLocal
    from app.models import AgentWorkflowRun
    with SessionLocal() as db:
        row = db.scalar(select(AgentWorkflowRun).where(
            AgentWorkflowRun.id == workflow_id
        ))
        assert row.status == "cancelled"
        assert row.attempt_count == 0
    try:
        job.delete(remove_from_queue=True)
    except Exception:
        pass
    connection.close()

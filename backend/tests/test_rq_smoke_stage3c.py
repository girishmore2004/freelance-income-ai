
"""Isolated RQ execution smoke test for Stage 3C.

Uses only TEST_REDIS_URL, which is provided by the temporary
Redis service in .github/workflows/full-ci.yml.

Never connects to the production REDIS_URL.
"""

import os
import uuid
import operator

import pytest


def test_rq_can_enqueue_and_execute_job_on_ci_redis():
    redis_url = os.getenv("TEST_REDIS_URL")

    if not redis_url:
        pytest.skip("TEST_REDIS_URL is not configured.")

    redis_module = pytest.importorskip("redis")
    rq_module = pytest.importorskip("rq")

    redis_connection = redis_module.Redis.from_url(
        redis_url,
        decode_responses=False,
        socket_connect_timeout=5,
        socket_timeout=5,
    )

    queue_name = f"fia-stage3c-test-{uuid.uuid4().hex}"
    queue = None
    job = None

    try:
        # Verify the isolated CI Redis service is reachable.
        assert redis_connection.ping() is True

        # Use a unique queue so this test cannot consume application jobs.
        queue = rq_module.Queue(
            queue_name,
            connection=redis_connection,
            default_timeout=30,
        )

        # Enqueue a deterministic, importable Python function.
        job = queue.enqueue(
            operator.add,
            args=(19, 23),
            job_timeout=30,
            result_ttl=60,
            failure_ttl=60,
        )

        assert job.id

        # Execute synchronously; no separate worker process is needed.
        worker = rq_module.SimpleWorker(
            [queue],
            connection=redis_connection,
        )

        worked = worker.work(
            burst=True,
            logging_level="WARNING",
        )

        assert worked is True

        job.refresh()

        assert job.is_finished
        assert job.result == 42

    finally:
        # Clean up only this test's uniquely named queue and job.
        if job is not None:
            try:
                job.delete()
            except Exception:
                pass

        if queue is not None:
            try:
                queue.empty()
                redis_connection.delete(queue.key)
            except Exception:
                pass

        redis_connection.close()

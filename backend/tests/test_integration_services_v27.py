"""Opt-in real service integration checks.

Set TEST_DATABASE_URL and TEST_REDIS_URL to isolated test services.
These tests do not create/drop application tables or flush shared Redis data.
"""
import os
import uuid
import pytest
from sqlalchemy import create_engine, text


pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def postgres_engine():
    url = os.getenv("TEST_DATABASE_URL", "").strip()
    if not url:
        pytest.skip("Set TEST_DATABASE_URL to an isolated PostgreSQL test database")
    engine = create_engine(url, pool_pre_ping=True)
    try:
        with engine.connect() as connection:
            assert connection.execute(text("SELECT 1")).scalar_one() == 1
            assert connection.dialect.name == "postgresql"
        yield engine
    finally:
        engine.dispose()


def test_postgres_connection_and_transaction_rollback(postgres_engine):
    with postgres_engine.connect() as connection:
        transaction = connection.begin()
        assert connection.execute(text("SELECT current_database()")).scalar_one()
        transaction.rollback()
        assert connection.execute(text("SELECT 1")).scalar_one() == 1


def test_redis_and_rq_enqueue_round_trip():
    url = os.getenv("TEST_REDIS_URL", "").strip()
    if not url:
        pytest.skip("Set TEST_REDIS_URL to an isolated Redis test database")
    redis_module = pytest.importorskip("redis", reason="Install backend requirements to run Redis integration")
    rq_module = pytest.importorskip("rq", reason="Install backend requirements to run RQ integration")
    connection = redis_module.Redis.from_url(url, socket_connect_timeout=3, socket_timeout=3)
    queue_name = "fia-v27-test-" + uuid.uuid4().hex
    queue = rq_module.Queue(queue_name, connection=connection)
    job = None
    try:
        assert connection.ping() is True
        job = queue.enqueue("builtins.abs", -42, result_ttl=0, failure_ttl=0)
        assert job.id
        assert job.get_status(refresh=True).value == "queued"
    finally:
        if job:
            try:
                job.delete()
            except Exception:
                pass
        queue.empty()
        connection.delete(queue.key)
        connection.close()

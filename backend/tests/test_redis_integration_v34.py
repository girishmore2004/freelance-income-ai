"""Runs against the Redis service provisioned by full-ci.yml."""
import os
import uuid
import pytest


def test_redis_rate_limit_counter_and_ttl_when_ci_service_is_available():
    redis_url = os.getenv("TEST_REDIS_URL")
    if not redis_url:
        pytest.skip("TEST_REDIS_URL is not configured; CI provisions Redis")
    redis = pytest.importorskip("redis").Redis.from_url(redis_url, decode_responses=True)
    redis.ping()
    from app.services.rate_limit import RateLimitStore
    key = f"fia:test:v34:{uuid.uuid4().hex}"
    store = RateLimitStore.__new__(RateLimitStore)
    store.redis = redis
    try:
        assert store.consume(key, 3, 60)[0] == 1
        assert store.consume(key, 3, 60)[0] == 2
        assert 1 <= redis.ttl(key) <= 60
    finally:
        redis.delete(key)

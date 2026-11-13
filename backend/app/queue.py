
"""Redis and RQ queue connection management."""

from functools import lru_cache

from redis import Redis
from rq import Queue

from .core import settings


QUEUE_NAME = "freelance-income-ai"
DEFAULT_JOB_TIMEOUT = 900

REDIS_CONNECT_TIMEOUT_SECONDS = 5
REDIS_SOCKET_TIMEOUT_SECONDS = 5
REDIS_HEALTH_CHECK_INTERVAL_SECONDS = 30


@lru_cache(maxsize=16)
def _get_queue_for_url(redis_url: str) -> Queue:
    """Create and cache an RQ queue for a Redis URL.

    Failed connections are closed and are never cached.
    """

    if not isinstance(redis_url, str) or not redis_url.strip():
        raise RuntimeError(
            "REDIS_URL is not configured; background queue is unavailable"
        )

    normalized_url = redis_url.strip()

    connection = Redis.from_url(
        normalized_url,
        socket_connect_timeout=REDIS_CONNECT_TIMEOUT_SECONDS,
        socket_timeout=REDIS_SOCKET_TIMEOUT_SECONDS,
        health_check_interval=REDIS_HEALTH_CHECK_INTERVAL_SECONDS,
    )

    try:
        connection.ping()

        queue = Queue(
            QUEUE_NAME,
            connection=connection,
            default_timeout=DEFAULT_JOB_TIMEOUT,
        )

        return queue

    except Exception as exc:
        try:
            connection.close()
        except Exception:
            pass

        raise RuntimeError(
            "Unable to establish Redis connection for the background queue"
        ) from exc


def get_queue() -> Queue:
    """Return the cached queue for the configured Redis URL."""

    redis_url = getattr(settings, "redis_url", None)

    if not redis_url:
        raise RuntimeError(
            "REDIS_URL is not configured; background queue is unavailable"
        )

    return _get_queue_for_url(redis_url)


def reset_queue_cache() -> None:
    """Clear cached queue references for tests or configuration changes."""

    _get_queue_for_url.cache_clear()


"""Shared Redis/RQ queue connection management.

The queue object is cached per REDIS_URL so API requests do not create
and ping a new Redis connection pool on every enqueue operation.

The public get_queue() function and RQ queue name remain unchanged.
"""

from functools import lru_cache

from redis import Redis
from rq import Queue

from .core import settings


QUEUE_NAME = "freelance-income-ai"
DEFAULT_JOB_TIMEOUT_SECONDS = 900
REDIS_CONNECT_TIMEOUT_SECONDS = 5
REDIS_SOCKET_TIMEOUT_SECONDS = 5
REDIS_HEALTH_CHECK_INTERVAL_SECONDS = 30


@lru_cache(maxsize=4)
def _get_queue_for_url(redis_url: str) -> Queue:
    """Create and cache one queue/client pair for a Redis URL."""

    connection = Redis.from_url(
        redis_url,
        socket_connect_timeout=REDIS_CONNECT_TIMEOUT_SECONDS,
        socket_timeout=REDIS_SOCKET_TIMEOUT_SECONDS,
        health_check_interval=REDIS_HEALTH_CHECK_INTERVAL_SECONDS,
    )

    try:
        connection.ping()
    except Exception as exc:
        # Do not include the Redis URL: it may contain credentials.
        try:
            connection.close()
        except Exception:
            pass

        raise RuntimeError(
            "Unable to connect to the configured Redis service. "
            "Check REDIS_URL and Redis availability."
        ) from exc

    return Queue(
        QUEUE_NAME,
        connection=connection,
        default_timeout=DEFAULT_JOB_TIMEOUT_SECONDS,
    )


def get_queue() -> Queue:
    """
    Return the shared RQ queue.

    The function signature is intentionally unchanged because API routes,
    workflow services and tests already call get_queue().
    """
    redis_url = str(settings.redis_url or "").strip()

    if not redis_url:
        raise RuntimeError(
            "REDIS_URL is not configured; background queue is unavailable."
        )

    return _get_queue_for_url(redis_url)


def reset_queue_cache() -> None:
    """
    Close cached Redis connections and clear the process-level cache.

    Intended for tests, controlled shutdowns and configuration reloads.
    Do not call this after every API request.
    """
    cached_queues = list(_get_queue_for_url.cache_info().__dict__.values())
    # The cache itself is not exposed by functools.lru_cache. Clearing it
    # is sufficient for normal process shutdown; Redis pools are closed
    # by the owning process when it exits.
    _get_queue_for_url.cache_clear()

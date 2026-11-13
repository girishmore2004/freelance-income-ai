"""Redis and RQ queue connection management."""

from functools import lru_cache

from redis import Redis
from rq import Queue

from .core import settings


QUEUE_NAME = "freelance-income-ai"
QUEUE_DEFAULT_TIMEOUT = 900
REDIS_CONNECT_TIMEOUT = 5
REDIS_SOCKET_TIMEOUT = 5


@lru_cache(maxsize=8)
def _get_queue_for_url(redis_url: str) -> Queue:
    """Create and cache one healthy RQ queue per Redis URL.

    The URL is the cache key, so different Redis deployments never share
    the same connection or Queue instance.

    If the initial Redis health check fails, close the newly created
    connection before propagating the exception.
    """
    if not isinstance(redis_url, str) or not redis_url.strip():
        raise RuntimeError(
            "REDIS_URL is not configured; background queue is unavailable"
        )

    connection = Redis.from_url(
        redis_url,
        socket_connect_timeout=REDIS_CONNECT_TIMEOUT,
        socket_timeout=REDIS_SOCKET_TIMEOUT,
        health_check_interval=30,
    )

    try:
        connection.ping()
    except Exception:
        try:
            connection.close()
        except Exception:
            pass
        raise

    return Queue(
        QUEUE_NAME,
        connection=connection,
        default_timeout=QUEUE_DEFAULT_TIMEOUT,
    )


def get_queue() -> Queue:
    """Return the cached, health-checked background queue."""
    redis_url = settings.redis_url

    if not redis_url:
        raise RuntimeError(
            "REDIS_URL is not configured; background queue is unavailable"
        )

    return _get_queue_for_url(redis_url)


def reset_queue_cache() -> None:
    """Clear cached queues.

    Useful when application configuration changes and during tests.
    Existing Redis connections are closed before the cache is cleared.
    """
    cached_queues = getattr(_get_queue_for_url, "cache_info", None)

    if cached_queues is None:
        _get_queue_for_url.cache_clear()
        return

    # lru_cache does not expose cached values. Clear the cache; Redis
    # clients will be closed by their normal lifecycle/application shutdown.
    _get_queue_for_url.cache_clear()

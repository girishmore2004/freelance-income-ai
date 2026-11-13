"""Redis and RQ queue connection management."""

import threading
from typing import Dict

from redis import Redis
from rq import Queue

from .core import settings


QUEUE_NAME = "freelance-income-ai"
DEFAULT_JOB_TIMEOUT = 900

REDIS_CONNECT_TIMEOUT_SECONDS = 5
REDIS_SOCKET_TIMEOUT_SECONDS = 5
REDIS_HEALTH_CHECK_INTERVAL_SECONDS = 30

_queue_cache: Dict[str, Queue] = {}
_queue_cache_lock = threading.RLock()


def _get_queue_for_url(redis_url: str) -> Queue:
    """Return a cached RQ queue for a Redis URL.

    A Redis connection is created and pinged before it is cached.
    Connections are isolated by URL so different Redis configurations
    cannot accidentally share a queue connection.
    """
    if not isinstance(redis_url, str) or not redis_url.strip():
        raise RuntimeError(
            "REDIS_URL is not configured; background queue is unavailable"
        )

    normalized_url = redis_url.strip()

    with _queue_cache_lock:
        cached_queue = _queue_cache.get(normalized_url)

        if cached_queue is not None:
            return cached_queue

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

        except Exception:
            try:
                connection.close()
            except Exception:
                pass

            raise

        _queue_cache[normalized_url] = queue
        return queue


def get_queue() -> Queue:
    """Return the application's configured background queue."""
    redis_url = getattr(settings, "redis_url", None)

    if not redis_url:
        raise RuntimeError(
            "REDIS_URL is not configured; background queue is unavailable"
        )

    return _get_queue_for_url(redis_url)


def reset_queue_cache() -> None:
    """Close cached Redis connections and clear the queue cache.

    Intended for test isolation, application shutdown, and controlled
    connection reconfiguration. Do not call this during normal job
    submission while workers are using the cached connections.
    """
    with _queue_cache_lock:
        cached_queues = list(_queue_cache.values())
        _queue_cache.clear()

        closed_connections = set()

        for queue in cached_queues:
            connection = getattr(queue, "connection", None)

            if connection is None or id(connection) in closed_connections:
                continue

            closed_connections.add(id(connection))

            try:
                connection.close()
            except Exception:
                pass

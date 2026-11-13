
"""Redis/RQ queue connection manager.

Features:
- Reuses Redis connections within a backend process.
- Preserves the existing get_queue() interface.
- Preserves the existing RQ queue name.
- Validates Redis connectivity when creating a connection.
- Closes failed connections.
- Provides an explicit cache reset for tests and shutdown.
- Avoids exposing Redis credentials in error messages.

This module remains compatible with the existing RQ worker.
It is not a Cloudflare Queues implementation.
"""

import logging
import threading

from redis import Redis
from rq import Queue

from .core import settings


logger = logging.getLogger(__name__)

QUEUE_NAME = "freelance-income-ai"

DEFAULT_JOB_TIMEOUT_SECONDS = 900
REDIS_CONNECT_TIMEOUT_SECONDS = 5
REDIS_SOCKET_TIMEOUT_SECONDS = 5
REDIS_HEALTH_CHECK_INTERVAL_SECONDS = 30

# One Redis client and Queue per configured Redis URL per process.
_queue_cache: dict[str, Queue] = {}
_cache_lock = threading.RLock()


def _create_queue(redis_url: str) -> Queue:
    """Create and validate a Redis connection and its RQ queue."""

    connection = Redis.from_url(
        redis_url,
        socket_connect_timeout=REDIS_CONNECT_TIMEOUT_SECONDS,
        socket_timeout=REDIS_SOCKET_TIMEOUT_SECONDS,
        health_check_interval=REDIS_HEALTH_CHECK_INTERVAL_SECONDS,
        retry_on_timeout=True,
    )

    try:
        connection.ping()

        return Queue(
            QUEUE_NAME,
            connection=connection,
            default_timeout=DEFAULT_JOB_TIMEOUT_SECONDS,
        )

    except Exception as exc:
        try:
            connection.close()
        except Exception:
            logger.warning(
                "Failed to close Redis connection after initialization error."
            )

        logger.error(
            "Unable to initialize the background queue connection."
        )

        raise RuntimeError(
            "Unable to connect to the configured Redis service. "
            "Verify REDIS_URL and Redis availability."
        ) from exc


def get_queue() -> Queue:
    """
    Return the shared RQ queue.

    Existing application code should continue calling:

        queue = get_queue()
        queue.enqueue(...)

    The Redis connection is reused until reset_queue_cache() is called
    or the application process exits.
    """

    redis_url = str(settings.redis_url or "").strip()

    if not redis_url:
        raise RuntimeError(
            "REDIS_URL is not configured; background queue is unavailable."
        )

    with _cache_lock:
        cached_queue = _queue_cache.get(redis_url)

        if cached_queue is not None:
            return cached_queue

        queue = _create_queue(redis_url)
        _queue_cache[redis_url] = queue

        return queue


def reset_queue_cache() -> None:
    """
    Close all cached Redis connections and clear the queue cache.

    Use this in tests, controlled shutdown hooks, or after deliberately
    changing Redis configuration.

    Do not call this during normal request processing.
    """

    with _cache_lock:
        cached_queues = list(_queue_cache.values())
        _queue_cache.clear()

    for queue in cached_queues:
        try:
            connection = queue.connection
            connection.close()
        except Exception:
            logger.warning(
                "Unable to close a cached Redis queue connection."
            )


def queue_health_check() -> dict:
    """
    Check whether the configured queue is reachable.

    Returns a safe diagnostic response without exposing Redis URLs,
    usernames, passwords, or connection details.
    """

    try:
        queue = get_queue()
        queue.connection.ping()

        return {
            "available": True,
            "queue_name": QUEUE_NAME,
            "status": "healthy",
        }

    except Exception:
        logger.exception("Background queue health check failed.")

        return {
            "available": False,
            "queue_name": QUEUE_NAME,
            "status": "unavailable",
            "error": "Background queue is unavailable.",
        }

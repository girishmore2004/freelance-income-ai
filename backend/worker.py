"""RQ worker entry point with a short-lived Redis heartbeat for diagnostics."""

import json
import os
import socket
import threading
import time

from redis import Redis
from rq import Worker, Queue

from app.core import settings


if not settings.redis_url:
    raise SystemExit(
        "REDIS_URL must be configured before starting the worker"
    )


connection = Redis.from_url(
    settings.redis_url,
    socket_connect_timeout=5,
    socket_timeout=5,
    health_check_interval=30,
)

try:
    connection.ping()
except Exception as exc:
    raise SystemExit(
        "Unable to connect to REDIS_URL; "
        "verify the worker service configuration."
    ) from exc


# Unique key for every worker process and host.
HEARTBEAT_KEY = (
    f"freelance-income-ai:worker:heartbeat:"
    f"{socket.gethostname()}:{os.getpid()}"
)

HEARTBEAT_TTL_SECONDS = 90
HEARTBEAT_INTERVAL_SECONDS = 25

stop_heartbeat = threading.Event()


def publish_heartbeat():
    """Publish an expiring heartbeat while the worker is alive."""

    payload = json.dumps(
        {
            "worker": socket.gethostname(),
            "pid": os.getpid(),
            "queue": "freelance-income-ai",
            "heartbeat_unix": time.time(),
        },
        separators=(",", ":"),
    )

    while not stop_heartbeat.is_set():
        try:
            connection.set(
                HEARTBEAT_KEY,
                payload,
                ex=HEARTBEAT_TTL_SECONDS,
            )
        except Exception:
            # Diagnostics will report a stale or missing heartbeat.
            pass

        stop_heartbeat.wait(HEARTBEAT_INTERVAL_SECONDS)


def main():
    """Start the RQ worker and manage its heartbeat lifecycle."""

    heartbeat_thread = threading.Thread(
        target=publish_heartbeat,
        name="worker-heartbeat",
        daemon=True,
    )

    heartbeat_thread.start()

    queues = [
        Queue(
            "freelance-income-ai",
            connection=connection,
        )
    ]

    try:
        Worker(
            queues,
            connection=connection,
        ).work(logging_level="INFO")

    finally:
        stop_heartbeat.set()
        heartbeat_thread.join(timeout=2)

        try:
            connection.delete(HEARTBEAT_KEY)
        except Exception:
            # Redis may already be unavailable during shutdown.
            pass


if __name__ == "__main__":
    main()

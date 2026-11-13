
"""RQ worker entry point with a Redis heartbeat for diagnostics.

The heartbeat format and Redis key are kept backward-compatible with
the diagnostics endpoint in app/main.py.

The RQ worker remains responsible for its normal job execution and
signal handling. The heartbeat thread is stopped during shutdown.
"""

import json
import logging
import os
import socket
import threading
import time

from redis import Redis
from rq import Queue, Worker

from app.core import settings


logger = logging.getLogger("freelance_income_ai.worker")

QUEUE_NAME = "freelance-income-ai"

HEARTBEAT_TTL_SECONDS = 90
HEARTBEAT_INTERVAL_SECONDS = 25

REDIS_CONNECT_TIMEOUT_SECONDS = 5
REDIS_SOCKET_TIMEOUT_SECONDS = 5
REDIS_HEALTH_CHECK_INTERVAL_SECONDS = 30

WORKER_HOSTNAME = socket.gethostname()
WORKER_PID = os.getpid()

HEARTBEAT_KEY = (
    f"freelance-income-ai:worker:heartbeat:"
    f"{WORKER_HOSTNAME}:{WORKER_PID}"
)

stop_heartbeat = threading.Event()


def create_redis_connection() -> Redis:
    """Create and validate the worker's Redis connection."""

    redis_url = str(settings.redis_url or "").strip()

    if not redis_url:
        raise RuntimeError(
            "REDIS_URL must be configured before starting the worker."
        )

    connection = Redis.from_url(
        redis_url,
        socket_connect_timeout=REDIS_CONNECT_TIMEOUT_SECONDS,
        socket_timeout=REDIS_SOCKET_TIMEOUT_SECONDS,
        health_check_interval=REDIS_HEALTH_CHECK_INTERVAL_SECONDS,
        retry_on_timeout=True,
    )

    try:
        connection.ping()
    except Exception as exc:
        try:
            connection.close()
        except Exception:
            logger.warning(
                "Unable to close Redis connection after startup failure."
            )

        raise RuntimeError(
            "Unable to connect to REDIS_URL. "
            "Verify the worker service configuration and Redis availability."
        ) from exc

    return connection


def build_heartbeat_payload() -> str:
    """
    Build the exact heartbeat structure expected by app/main.py.

    Do not rename these keys without updating the diagnostics endpoint.
    """

    return json.dumps(
        {
            "worker": WORKER_HOSTNAME,
            "pid": WORKER_PID,
            "queue": QUEUE_NAME,
            "heartbeat_unix": time.time(),
        },
        separators=(",", ":"),
    )


def publish_heartbeat(connection: Redis) -> None:
    """
    Publish periodic worker health information.

    The first heartbeat is published immediately. Subsequent heartbeats
    are published every HEARTBEAT_INTERVAL_SECONDS.

    Redis failures are logged, but do not terminate the worker. The
    diagnostics endpoint will report a stale or missing heartbeat.
    """

    while not stop_heartbeat.is_set():
        try:
            connection.set(
                HEARTBEAT_KEY,
                build_heartbeat_payload(),
                ex=HEARTBEAT_TTL_SECONDS,
            )

        except Exception:
            logger.exception(
                "Worker heartbeat could not be published."
            )

        # Event.wait allows graceful shutdown to interrupt the interval.
        stop_heartbeat.wait(HEARTBEAT_INTERVAL_SECONDS)


def start_heartbeat_thread(connection: Redis) -> threading.Thread:
    """Start the background heartbeat publisher."""

    thread = threading.Thread(
        target=publish_heartbeat,
        args=(connection,),
        name="freelance-income-ai-worker-heartbeat",
        daemon=True,
    )

    thread.start()
    return thread


def run_worker() -> None:
    """Start the RQ worker and clean up resources on shutdown."""

    connection = create_redis_connection()

    heartbeat_thread = None

    try:
        queue = Queue(
            QUEUE_NAME,
            connection=connection,
        )

        worker = Worker(
            [queue],
            connection=connection,
        )

        logger.info(
            "Starting RQ worker. hostname=%s pid=%s queue=%s",
            WORKER_HOSTNAME,
            WORKER_PID,
            QUEUE_NAME,
        )

        stop_heartbeat.clear()
        heartbeat_thread = start_heartbeat_thread(connection)

        # RQ handles its normal worker lifecycle and termination signals.
        worker.work(
            logging_level="INFO",
        )

        logger.info(
            "RQ worker stopped normally. hostname=%s pid=%s",
            WORKER_HOSTNAME,
            WORKER_PID,
        )

    finally:
        logger.info("Stopping worker heartbeat.")

        stop_heartbeat.set()

        if heartbeat_thread is not None:
            heartbeat_thread.join(
                timeout=HEARTBEAT_INTERVAL_SECONDS + 5
            )

            if heartbeat_thread.is_alive():
                logger.warning(
                    "Heartbeat thread did not stop within the expected time."
                )

        # Remove this process's heartbeat during graceful shutdown.
        try:
            connection.delete(HEARTBEAT_KEY)
        except Exception:
            logger.warning(
                "Unable to delete worker heartbeat during shutdown."
            )

        try:
            connection.close()
        except Exception:
            logger.warning(
                "Unable to close the worker Redis connection."
            )


def main() -> None:
    """Configure logging and launch the worker."""

    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format=(
            "%(asctime)s %(levelname)s "
            "%(name)s: %(message)s"
        ),
    )

    try:
        run_worker()
    except KeyboardInterrupt:
        logger.info("Worker interrupted.")
    except Exception:
        logger.exception("RQ worker terminated with an error.")
        raise


if __name__ == "__main__":
    main()

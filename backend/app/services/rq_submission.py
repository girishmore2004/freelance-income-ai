"""Idempotent submission helpers for RQ-backed workflows."""

from typing import Any

from rq.job import Job
from rq.exceptions import NoSuchJobError

from app.queue import get_queue


def enqueue_once(
    function: str,
    *args: Any,
    job_id: str,
    **kwargs: Any,
) -> Job:
    """Enqueue a job once, using a deterministic RQ job ID.

    If the job already exists in Redis, return the existing job rather
    than submitting another copy.

    Args:
        function: Import path of the worker function.
        *args: Positional arguments passed to the worker function.
        job_id: Stable, deterministic RQ job identifier.
        **kwargs: Keyword arguments passed to Queue.enqueue.

    Returns:
        The existing or newly created RQ Job.

    Raises:
        ValueError: If the function or job ID is invalid.
        Exception: Redis, queue, or enqueue errors other than a missing
            RQ job are allowed to propagate to the caller.
    """
    if not isinstance(function, str) or not function.strip():
        raise ValueError("function must be a non-empty import path")

    if not isinstance(job_id, str) or not job_id.strip():
        raise ValueError("job_id must be a non-empty string")

    queue = get_queue()

    try:
        return Job.fetch(job_id, connection=queue.connection)
    except NoSuchJobError:
        pass

    return queue.enqueue(
        function,
        *args,
        job_id=job_id,
        **kwargs,
    )


"""Idempotent RQ submission helpers."""

from rq.job import Job


def enqueue_once(
    queue,
    function,
    *args,
    job_id: str,
    **kwargs,
):
    """
    Enqueue a job exactly once for a deterministic RQ job ID.

    If the job ID already exists, return that job. If enqueue fails for
    another reason, re-raise the original error unless an existing job
    with the same ID can be recovered.

    This prevents duplicate queue records for the same workflow attempt.
    It does not guarantee exactly-once execution by a worker.
    """
    if not job_id or len(job_id) > 200:
        raise ValueError("A valid RQ job_id is required.")

    try:
        return queue.enqueue(
            function,
            *args,
            job_id=job_id,
            **kwargs,
        )
    except Exception:
        try:
            existing = Job.fetch(
                job_id,
                connection=queue.connection,
            )
            return existing
        except Exception:
            raise

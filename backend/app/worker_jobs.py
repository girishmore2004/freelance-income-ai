
"""RQ worker tasks for saved opportunity discovery.

The job record is the source of truth. Queue delivery is treated as
at-least-once: completed jobs must not execute again, and a job must
belong to the user supplied in the queue payload.
"""

import json
import time

from datetime import datetime, timezone, timedelta

from sqlalchemy import select

from .database import SessionLocal
from .models import (
    BackgroundJob,
    User,
    OpportunitySource,
    AgentRun,
)
from .connectors import (
    parse_rss,
    parse_json_api,
    ConnectorError,
)
from .services.discovery import upsert_discovered_opportunity
from .services.source_health import (
    retry_delay_minutes,
    health_status_for_failures,
)
from .main_helpers import profile_dict


def _result_from_job(job: BackgroundJob) -> dict:
    """Return a previously persisted result without rerunning the job."""
    try:
        result = json.loads(job.result_json or "{}")
    except (TypeError, ValueError):
        result = {}

    return {
        "job_id": job.id,
        "status": job.status,
        "already_processed": True,
        "result": result,
    }


def run_saved_multi_source_discovery(
    job_id: str,
    user_id: str,
) -> dict:
    """
    Execute saved RSS/JSON opportunity discovery.

    Duplicate queue delivery is safe for completed jobs. A job belonging
    to another user is rejected before any source or user data is accessed.
    """
    db = SessionLocal()

    try:
        # Claim the job under a row lock. PostgreSQL workers serialize
        # claims for the same job; SQLite ignores FOR UPDATE.
        job = db.scalar(
            select(BackgroundJob)
            .where(BackgroundJob.id == job_id)
            .with_for_update()
        )

        if not job:
            raise ValueError("Background job not found")

        # Never trust the user_id supplied by the queue payload.
        if job.user_id != user_id:
            raise PermissionError(
                "Background job does not belong to the supplied user"
            )

        # At-least-once queue delivery: do not repeat completed work.
        if job.status == "completed":
            return _result_from_job(job)

        # A duplicate delivery must not start a second execution while
        # another worker has already claimed this job.
        if job.status == "running":
            return {
                "job_id": job.id,
                "status": "running",
                "already_processing": True,
            }

        # Failed jobs can be retried. Other terminal states are not run.
        if job.status not in {"queued", "failed"}:
            return {
                "job_id": job.id,
                "status": job.status,
                "already_processed": True,
            }

        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        job.finished_at = None
        job.error_message = ""
        db.commit()

        user = db.get(User, user_id)
        if not user:
            raise ValueError("User not found")

        sources = db.scalars(
            select(OpportunitySource).where(
                OpportunitySource.user_id == user_id,
                OpportunitySource.enabled.is_(True),
            )
        ).all()

        profile = profile_dict(db, user)

        created = 0
        found = 0
        duplicates = 0
        errors = []

        for source in sources:
            now = datetime.now(timezone.utc)
            retry_at = source.next_retry_at

            if retry_at and retry_at.tzinfo is None:
                retry_at = retry_at.replace(tzinfo=timezone.utc)

            if retry_at and retry_at > now:
                errors.append({
                    "source_id": source.id,
                    "source_name": source.name,
                    "status": "backoff",
                    "retry_at": retry_at.isoformat(),
                })
                continue

            started = time.monotonic()
            source.last_checked_at = now

            try:
                if source.source_type == "json_api":
                    items = parse_json_api(source.feed_url)
                else:
                    items = parse_rss(source.feed_url)

                found += len(items)

                for item in items:
                    item["source"] = source.source_type
                    item["source_origin"] = source.name

                    row, is_new = upsert_discovered_opportunity(
                        db,
                        user,
                        profile,
                        item,
                    )

                    if is_new:
                        created += 1
                    else:
                        duplicates += 1

                source.health_status = "healthy"
                source.consecutive_failures = 0
                source.total_items_seen = (
                    (source.total_items_seen or 0) + len(items)
                )
                source.last_success_at = datetime.now(timezone.utc)
                source.next_retry_at = None
                source.last_error = ""

            except ConnectorError as exc:
                source.consecutive_failures = (
                    (source.consecutive_failures or 0) + 1
                )

                delay_minutes = retry_delay_minutes(
                    source.consecutive_failures
                )

                source.next_retry_at = (
                    datetime.now(timezone.utc)
                    + timedelta(minutes=delay_minutes)
                )

                source.health_status = health_status_for_failures(
                    source.consecutive_failures
                )
                source.last_error = str(exc)[:1500]

                errors.append({
                    "source_id": source.id,
                    "source_name": source.name,
                    "error": str(exc),
                    "retry_after_minutes": delay_minutes,
                })

            finally:
                source.last_latency_ms = int(
                    (time.monotonic() - started) * 1000
                )
                db.commit()

        result = {
            "sources_checked": len(sources),
            "found": found,
            "created": created,
            "duplicates_refreshed": duplicates,
            "errors": errors,
        }

        db.add(
            AgentRun(
                user_id=user_id,
                agent_name="discovery_agent",
                summary=(
                    f"Multi-source scan: {found} read, {created} new, "
                    f"{duplicates} duplicates refreshed, "
                    f"{len(errors)} errors"
                ),
            )
        )

        # Reload the job to ensure the persisted record still exists.
        job = db.get(BackgroundJob, job_id)

        if not job or job.user_id != user_id:
            raise RuntimeError(
                "Background job ownership changed during execution"
            )

        job.status = "completed"
        job.result_json = json.dumps(result, default=str)
        job.error_message = ""
        job.finished_at = datetime.now(timezone.utc)

        db.commit()

        return result

    except Exception as exc:
        db.rollback()

        # Only mark the job failed if the job belongs to this user.
        job = db.get(BackgroundJob, job_id)

        if job and job.user_id == user_id and job.status != "completed":
            job.status = "failed"
            job.error_message = str(exc)[:2000]
            job.finished_at = datetime.now(timezone.utc)
            db.commit()

        raise

    finally:
        db.close()


# Backward-compatible alias for already queued v0.3/v0.6 jobs.
run_saved_rss_discovery = run_saved_multi_source_discovery

"""RQ worker tasks. Execute with `rq worker freelance-income-ai` from backend."""
import json
from datetime import datetime, timezone, timedelta
import time
from sqlalchemy import select
from .database import SessionLocal
from .models import BackgroundJob, User, OpportunitySource, Opportunity, AgentRun
from .core import settings
from .connectors import parse_rss, parse_json_api, ConnectorError
from .services.discovery import upsert_discovered_opportunity
from .services.source_health import retry_delay_minutes, health_status_for_failures
from .main_helpers import profile_dict
from .orchestrator import run_opportunity_graph

def run_saved_multi_source_discovery(job_id: str, user_id: str) -> dict:
    db = SessionLocal()
    job = db.get(BackgroundJob, job_id)
    if not job:
        db.close()
        raise ValueError("Background job not found")
    try:
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        db.commit()
        user = db.get(User, user_id)
        if not user:
            raise ValueError("User not found")
        sources = db.scalars(select(OpportunitySource).where(
            OpportunitySource.user_id == user_id, OpportunitySource.enabled.is_(True)
        )).all()
        profile = profile_dict(db, user)
        created, found, duplicates, errors = 0, 0, 0, []
        for source in sources:
            now = datetime.now(timezone.utc)
            retry_at = source.next_retry_at
            if retry_at and retry_at.tzinfo is None:
                retry_at = retry_at.replace(tzinfo=timezone.utc)
            if retry_at and retry_at > now:
                errors.append({"source_id": source.id, "source_name": source.name,
                               "status": "backoff", "retry_at": retry_at.isoformat()})
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
                    row, is_new = upsert_discovered_opportunity(db, user, profile, item)
                    if is_new:
                        created += 1
                    else:
                        duplicates += 1
                source.health_status = "healthy"
                source.consecutive_failures = 0
                source.total_items_seen = (source.total_items_seen or 0) + len(items)
                source.last_success_at = datetime.now(timezone.utc)
                source.next_retry_at = None
                source.last_error = ""
            except ConnectorError as exc:
                source.consecutive_failures = (source.consecutive_failures or 0) + 1
                delay_minutes = retry_delay_minutes(source.consecutive_failures)
                source.next_retry_at = datetime.now(timezone.utc) + timedelta(minutes=delay_minutes)
                source.health_status = health_status_for_failures(source.consecutive_failures)
                source.last_error = str(exc)[:1500]
                errors.append({"source_id": source.id, "source_name": source.name,
                               "error": str(exc), "retry_after_minutes": delay_minutes})
            finally:
                source.last_latency_ms = int((time.monotonic() - started) * 1000)
                db.commit()
        result = {"sources_checked": len(sources), "found": found, "created": created,
                  "duplicates_refreshed": duplicates, "errors": errors}
        db.add(AgentRun(user_id=user_id, agent_name="discovery_agent",
                        summary=f"Multi-source scan: {found} read, {created} new, {duplicates} duplicates refreshed, {len(errors)} errors"))
        job.status = "completed"
        job.result_json = json.dumps(result)
        job.finished_at = datetime.now(timezone.utc)
        db.commit()
        return result
    except Exception as exc:
        db.rollback()
        job = db.get(BackgroundJob, job_id)
        if job:
            job.status = "failed"
            job.error_message = str(exc)[:2000]
            job.finished_at = datetime.now(timezone.utc)
            db.commit()
        raise
    finally:
        db.close()


# Backward-compatible alias for already queued v0.3/v0.6 jobs.\nrun_saved_rss_discovery = run_saved_multi_source_discovery\n
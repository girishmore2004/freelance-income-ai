"""Run due saved Upwork searches. Configure as a 15-minute Render Cron Job.

Command (from backend/): python -m app.scheduled_discovery
The runner only performs read-only discovery. Proposal submission is not part
of this job. Upwork listing retention must be enabled and separately scheduled.
"""
import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from .core import settings
from .database import SessionLocal
from .models import SavedMarketplaceSearch, User
from .main import perform_upwork_search


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


async def run_due_saved_searches() -> dict:
    if not settings.upwork_cache_retention_enabled:
        print("Saved discovery skipped: UPWORK_CACHE_RETENTION_ENABLED is false")
        return {"claimed": 0, "succeeded": 0, "failed": 0, "skipped": True}

    db = SessionLocal()
    stats = {"claimed": 0, "succeeded": 0, "failed": 0, "skipped": False}
    try:
        now = datetime.now(timezone.utc)
        due = db.scalars(
            select(SavedMarketplaceSearch)
            .where(SavedMarketplaceSearch.provider == "upwork",
                   SavedMarketplaceSearch.is_active.is_(True),
                   SavedMarketplaceSearch.next_run_at.is_not(None),
                   SavedMarketplaceSearch.next_run_at <= now)
            .order_by(SavedMarketplaceSearch.next_run_at.asc())
            .limit(50)
        ).all()
        ids = [row.id for row in due]
        for search_id in ids:
            # Claim before the network call so overlapping cron invocations do not
            # intentionally process the same row. A failed attempt is rescheduled.
            row = db.scalar(select(SavedMarketplaceSearch).where(
                SavedMarketplaceSearch.id == search_id).with_for_update())
            due_at = _utc(row.next_run_at) if row else None
            if not row or not row.is_active or not due_at or due_at > now:
                continue
            claimed_at = datetime.now(timezone.utc)
            row.next_run_at = claimed_at + timedelta(hours=row.interval_hours)
            db.commit()
            stats["claimed"] += 1
            user = db.get(User, row.user_id)
            if not user:
                row.last_error = "Owning account no longer exists."
                row.is_active = False
                row.next_run_at = None
                db.commit()
                stats["failed"] += 1
                continue
            try:
                result = await perform_upwork_search(
                    db, user, row.search_term, row.result_limit, actor="system")
                row = db.get(SavedMarketplaceSearch, search_id)
                if row:
                    completed = datetime.now(timezone.utc)
                    row.last_run_at = completed
                    row.next_run_at = completed + timedelta(hours=row.interval_hours)
                    row.last_result_count = int(result.get("returned", 0))
                    row.last_error = ""
                db.commit()
                stats["succeeded"] += 1
            except Exception as exc:
                db.rollback()
                row = db.get(SavedMarketplaceSearch, search_id)
                if row:
                    failed_at = datetime.now(timezone.utc)
                    row.last_run_at = failed_at
                    row.next_run_at = failed_at + timedelta(hours=row.interval_hours)
                    # Store only a bounded, sanitized error string; never provider payloads/tokens.
                    safe_detail = getattr(exc, "detail", None)
                    row.last_error = (str(safe_detail) if safe_detail else type(exc).__name__)[:500]
                    db.commit()
                stats["failed"] += 1
        return stats
    finally:
        db.close()


def main() -> int:
    stats = asyncio.run(run_due_saved_searches())
    print(f"Saved marketplace discovery: {stats}")
    return int(stats["failed"] > 0)


if __name__ == "__main__":
    raise SystemExit(main())

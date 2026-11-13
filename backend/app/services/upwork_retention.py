"""Enforce the Upwork API's maximum 24-hour response-cache window.

The cleanup command is intended for an hourly scheduled job. A 22-hour
cutoff leaves a two-hour safety margin. Expired provider listing content is redacted;
user-authored proposal/review history and the stable external ID remain.
"""
from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session
from ..models import Opportunity

CACHE_WINDOW_HOURS = 22


def expire_stale_upwork_listings(db: Session, user_id: str | None = None,
                                 now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=CACHE_WINDOW_HOURS)
    query = select(Opportunity).where(
        Opportunity.source == "upwork_api",
        Opportunity.status != "expired",
        Opportunity.last_seen_at.is_not(None),
        Opportunity.last_seen_at <= cutoff,
    )
    if user_id:
        query = query.where(Opportunity.user_id == user_id)
    rows = db.scalars(query).all()
    for row in rows:
        row.title = "Expired Upwork listing"
        row.client_name = "Upwork client"
        row.description = "The 22-hour marketplace listing cache has expired. Run a new Upwork search to retrieve current listing details."
        row.source_url = ""
        row.budget_min = None
        row.budget_max = None
        row.currency = "N/A"
        row.required_skills = "[]"
        row.deadline = ""
        row.job_type = "unknown"
        row.industry = ""
        row.estimated_hours = None
        row.competition_level = "unknown"
        row.client_rating = None
        row.client_reviews = None
        row.client_payment_verified = None
        row.status = "expired"
        row.match_score = 0
        row.score_breakdown = "{}"
        row.source_fingerprint = None
        row.published_at = None
        row.source_origins = "[]"
    if rows:
        db.flush()
    return len(rows)

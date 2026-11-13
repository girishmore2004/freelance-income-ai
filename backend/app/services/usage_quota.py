"""Durable per-account AI usage quotas and transparent usage summaries.

Counts successful AI operations. Token/cost estimates are deliberately omitted
until a provider returns trustworthy token usage and pricing metadata.
"""
from datetime import datetime, timezone, timedelta
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from ..models import AIUsageEvent, AbuseEvent, User
from ..core import settings


def _month_start(now):
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def usage_totals(db: Session, user_id: str, now=None):
    now = now or datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = _month_start(now)
    day_count = db.scalar(select(func.count(AIUsageEvent.id)).where(
        AIUsageEvent.user_id == user_id, AIUsageEvent.created_at >= day_start)) or 0
    month_count = db.scalar(select(func.count(AIUsageEvent.id)).where(
        AIUsageEvent.user_id == user_id, AIUsageEvent.created_at >= month_start)) or 0
    return {"daily_calls": int(day_count), "monthly_calls": int(month_count),
            "daily_limit": settings.ai_quota_daily_calls,
            "monthly_limit": settings.ai_quota_monthly_calls,
            "remaining_daily": max(0, settings.ai_quota_daily_calls - int(day_count)),
            "remaining_monthly": max(0, settings.ai_quota_monthly_calls - int(month_count))}


def enforce_quota(db: Session, user_id: str, operation: str):
    # Serialize quota checks for this account on PostgreSQL. The lock remains
    # held until the request records usage or commits its fallback result.
    db.scalar(select(User).where(User.id == user_id).with_for_update())
    totals = usage_totals(db, user_id)
    if totals["daily_calls"] >= totals["daily_limit"] or totals["monthly_calls"] >= totals["monthly_limit"]:
        db.add(AbuseEvent(user_id=user_id, event_type="ai_quota_exhausted",
                          detail=f"AI operation blocked: {operation[:80]}"))
        db.commit()
        return False, totals
    return True, totals


def record_usage(db: Session, user_id: str, operation: str, provider: str,
                 input_chars: int = 0, output_chars: int = 0):
    row = AIUsageEvent(user_id=user_id, operation=operation[:80], provider=provider[:40],
                       input_chars=max(0, int(input_chars)), output_chars=max(0, int(output_chars)))
    db.add(row)
    db.commit()
    return row


def usage_history(db: Session, user_id: str, limit: int = 50):
    """Return only the authenticated account's recent usage events."""
    rows = db.scalars(select(AIUsageEvent).where(
        AIUsageEvent.user_id == user_id
    ).order_by(AIUsageEvent.created_at.desc()).limit(max(1, min(int(limit), 100)))).all()
    return [{
        "id": row.id, "operation": row.operation, "provider": row.provider,
        "input_chars": row.input_chars, "output_chars": row.output_chars,
        "created_at": row.created_at.isoformat(),
    } for row in rows]


def abuse_summary(db: Session, user_id: str, limit: int = 50):
    """Return a privacy-safe abuse-event summary scoped to one account."""
    rows = db.scalars(select(AbuseEvent).where(
        AbuseEvent.user_id == user_id
    ).order_by(AbuseEvent.created_at.desc()).limit(max(1, min(int(limit), 100)))).all()
    counts = db.execute(select(AbuseEvent.event_type, func.count(AbuseEvent.id)).where(
        AbuseEvent.user_id == user_id,
        AbuseEvent.created_at >= datetime.now(timezone.utc) - timedelta(days=30)
    ).group_by(AbuseEvent.event_type)).all()
    return {
        "last_30_days": {kind: int(count) for kind, count in counts},
        "events": [{"id": row.id, "event_type": row.event_type,
                    "detail": row.detail, "created_at": row.created_at.isoformat()}
                   for row in rows],
    }


def usage_report(db: Session, user_id: str, days: int = 30):
    """Account-scoped operational usage report; reports characters, never guessed tokens/cost."""
    days = max(1, min(int(days), 90))
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = db.execute(
        select(AIUsageEvent.operation, AIUsageEvent.provider,
               func.count(AIUsageEvent.id), func.coalesce(func.sum(AIUsageEvent.input_chars), 0),
               func.coalesce(func.sum(AIUsageEvent.output_chars), 0))
        .where(AIUsageEvent.user_id == user_id, AIUsageEvent.created_at >= since)
        .group_by(AIUsageEvent.operation, AIUsageEvent.provider)
        .order_by(func.count(AIUsageEvent.id).desc())
    ).all()
    daily = db.execute(
        select(func.date(AIUsageEvent.created_at), func.count(AIUsageEvent.id))
        .where(AIUsageEvent.user_id == user_id, AIUsageEvent.created_at >= since)
        .group_by(func.date(AIUsageEvent.created_at))
        .order_by(func.date(AIUsageEvent.created_at))
    ).all()
    return {
        "period_days": days,
        "by_operation_provider": [
            {"operation": operation, "provider": provider, "calls": int(calls),
             "input_chars": int(input_chars), "output_chars": int(output_chars)}
            for operation, provider, calls, input_chars, output_chars in rows
        ],
        "daily_calls": [{"date": str(day), "calls": int(calls)} for day, calls in daily],
        "cost_tracking": "unavailable_without_verified_provider_token_usage_and_pricing",
    }


def cleanup_abuse_events(db: Session, retention_days: int = 90, apply: bool = False):
    """Delete old abuse events only when explicitly requested; dry-run is the default."""
    retention_days = max(7, min(int(retention_days), 3650))
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    query = select(func.count(AbuseEvent.id)).where(AbuseEvent.created_at < cutoff)
    count = int(db.scalar(query) or 0)
    if apply and count:
        from sqlalchemy import delete
        db.execute(delete(AbuseEvent).where(AbuseEvent.created_at < cutoff))
        db.commit()
    return {"retention_days": retention_days, "eligible_events": count,
            "deleted_events": count if apply else 0, "mode": "apply" if apply else "dry_run"}

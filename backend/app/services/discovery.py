import hashlib
import json
from datetime import datetime, timezone
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode
from sqlalchemy import select
from ..scoring import score_opportunity

TRACKING_KEYS = {"fbclid", "gclid", "ref", "source", "campaign"}
def canonical_listing_url(url):
    if not url:
        return ""
    try:
        parsed = urlparse(url.strip())
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
            return ""
        host = parsed.hostname.lower()
        host = host.rstrip(".")
        port = parsed.port
        default_port = 443 if parsed.scheme.lower() == "https" else 80
        netloc = host if port in (None, default_port) else f"{host}:{port}"
        path = parsed.path.rstrip("/") or "/"
        query = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True)
                 if not k.lower().startswith("utm_") and k.lower() not in TRACKING_KEYS]
        return urlunparse((parsed.scheme.lower(), netloc, path, "", urlencode(sorted(query)), ""))
    except Exception:
        return ""

def listing_fingerprint(item):
    canonical = canonical_listing_url(item.get("source_url", ""))
    if canonical:
        material = canonical
    else:
        material = f"{item.get('source','unknown')}:{item.get('external_id','')}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()

def _parse_published(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        try:
            from email.utils import parsedate_to_datetime
            dt = parsedate_to_datetime(str(value))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except Exception:
            return None

def upsert_discovered_opportunity(db, user, profile, item):
    from ..models import Opportunity
    now = datetime.now(timezone.utc)
    fingerprint = listing_fingerprint(item)
    existing = db.scalar(select(Opportunity).where(
        Opportunity.user_id == user.id,
        Opportunity.source_fingerprint == fingerprint,
    ))
    if existing is None and item.get("source_url"):
        existing = db.scalar(select(Opportunity).where(
            Opportunity.user_id == user.id,
            Opportunity.source_fingerprint.is_(None),
            Opportunity.source_url == item.get("source_url"),
        ))
    if existing is None and item.get("external_id"):
        existing = db.scalar(select(Opportunity).where(
            Opportunity.user_id == user.id,
            Opportunity.source == str(item.get("source") or "unknown"),
            Opportunity.external_id == str(item.get("external_id"))[:255],
        ))
    source_label = str(item.get("source_origin") or item.get("source") or "unknown")
    if existing:
        if existing.status == "expired" and str(item.get("source") or "") == "upwork_api":
            score, breakdown = score_opportunity(profile, item)
            existing.title = str(item.get("title") or "Untitled")[:300]
            existing.client_name = str(item.get("client_name") or "Unknown")[:200]
            existing.description = str(item.get("description") or "")[:12000]
            existing.source_url = str(item.get("source_url") or "")[:1200]
            existing.budget_min = item.get("budget_min")
            existing.budget_max = item.get("budget_max")
            existing.currency = str(item.get("currency") or "INR")[:8]
            existing.required_skills = json.dumps(item.get("required_skills") or [])
            existing.deadline = str(item.get("deadline") or "")[:80]
            existing.job_type = str(item.get("job_type") or "unknown")[:30]
            existing.industry = str(item.get("industry") or "")[:100]
            existing.estimated_hours = item.get("estimated_hours")
            existing.competition_level = str(item.get("competition_level") or "unknown")[:20]
            existing.client_rating = item.get("client_rating")
            existing.client_reviews = item.get("client_reviews")
            existing.client_payment_verified = item.get("client_payment_verified")
            existing.match_score = score
            existing.score_breakdown = json.dumps(breakdown)
            existing.status = "new"
            existing.published_at = _parse_published(item.get("published_at"))
            existing.source_fingerprint = fingerprint
        origins = json.loads(existing.source_origins or "[]")
        if source_label not in origins:
            origins.append(source_label)
        existing.source_origins = json.dumps(origins)
        existing.duplicate_count = (existing.duplicate_count or 0) + 1
        existing.source_fingerprint = fingerprint
        existing.first_seen_at = existing.first_seen_at or existing.created_at
        existing.last_seen_at = now
        if existing.published_at is None and item.get("published_at"):
            existing.published_at = _parse_published(item.get("published_at"))
        if not existing.source_url and item.get("source_url"):
            existing.source_url = item["source_url"]
        db.flush()
        return existing, False

    score, breakdown = score_opportunity(profile, item)
    published = _parse_published(item.get("published_at"))
    row = Opportunity(
        user_id=user.id,
        source=str(item.get("source") or "unknown"),
        external_id=str(item.get("external_id") or fingerprint)[:255],
        title=str(item.get("title") or "Untitled")[:300],
        client_name=str(item.get("client_name") or "Unknown")[:200],
        description=str(item.get("description") or "")[:12000],
        source_url=str(item.get("source_url") or "")[:1200],
        budget_min=item.get("budget_min"),
        budget_max=item.get("budget_max"),
        currency=str(item.get("currency") or "INR")[:8],
        required_skills=json.dumps(item.get("required_skills") or []),
        deadline=str(item.get("deadline") or "")[:80],
        job_type=str(item.get("job_type") or "unknown")[:30],
        industry=str(item.get("industry") or "")[:100],
        estimated_hours=item.get("estimated_hours"),
        competition_level=str(item.get("competition_level") or "unknown")[:20],
        client_rating=item.get("client_rating"),
        client_reviews=item.get("client_reviews"),
        client_payment_verified=item.get("client_payment_verified"),
        match_score=score,
        score_breakdown=json.dumps(breakdown),
        source_fingerprint=fingerprint,
        first_seen_at=now,
        last_seen_at=now,
        published_at=published,
        duplicate_count=0,
        source_origins=json.dumps([source_label]),
    )
    db.add(row)
    db.flush()
    return row, True

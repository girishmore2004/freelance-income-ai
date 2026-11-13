"""Read-only Upwork GraphQL marketplace discovery.

Only the documented marketplaceJobPostingsSearch query is used. This module
never invokes mutations or submits proposals. Provider access is verified only
when a successful authenticated GraphQL request returns usable data.
"""
from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core import settings
from ..models import MarketplaceCredential
from .marketplace_credentials import load_tokens
from .upwork_oauth import refresh_upwork_token

GRAPHQL_URL = "https://api.upwork.com/graphql"
SEARCH_QUERY = """
query SearchJobs($filter: MarketplaceJobPostingsSearchFilter) {
  marketplaceJobPostingsSearch(
    marketPlaceJobFilter: $filter
    searchType: USER_JOBS_SEARCH
    sortAttributes: [{ field: RECENCY }]
  ) {
    totalCount
    edges {
      cursor
      node {
        id
        title
        description
        ciphertext
        amount { displayValue currency }
        hourlyBudgetMin { displayValue currency }
        hourlyBudgetMax { displayValue currency }
        skills { name }
        client { totalFeedback totalReviews totalHires }
        totalApplicants
        createdDateTime
        publishedDateTime
        engagement
        category
        subcategory
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
""".strip()


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _money_value(value: Any) -> tuple[float | None, str | None]:
    if not isinstance(value, dict):
        return None, None
    raw = value.get("displayValue")
    if raw is None:
        return None, str(value.get("currency") or "") or None
    match = re.search(r"-?\d[\d,]*(?:\.\d+)?", str(raw))
    amount = float(match.group(0).replace(",", "")) if match else None
    return amount, str(value.get("currency") or "") or None


def map_upwork_job(node: dict[str, Any]) -> dict[str, Any] | None:
    """Map documented Upwork search result fields into the app's feed schema."""
    external_id = str(node.get("id") or "").strip()
    title = str(node.get("title") or "").strip()
    if not external_id or len(title) < 3:
        return None
    description = str(node.get("description") or "No description provided in the marketplace listing.").strip()
    if len(description) < 10:
        description = (description + " No additional description was provided.").strip()
    fixed, fixed_currency = _money_value(node.get("amount"))
    hourly_min, hourly_min_currency = _money_value(node.get("hourlyBudgetMin"))
    hourly_max, hourly_max_currency = _money_value(node.get("hourlyBudgetMax"))
    engagement = str(node.get("engagement") or "").lower()
    if hourly_min is not None or hourly_max is not None or "hour" in engagement:
        job_type = "hourly"
        budget_min, budget_max = hourly_min, hourly_max
    elif fixed is not None:
        job_type = "fixed"
        budget_min = budget_max = fixed
    else:
        job_type = "unknown"
        budget_min = budget_max = None
    currency = (fixed_currency or hourly_min_currency or hourly_max_currency or "N/A").upper()[:8]
    client = node.get("client") if isinstance(node.get("client"), dict) else {}
    rating = client.get("totalFeedback")
    try:
        rating = float(rating) if rating is not None else None
        if rating is not None and rating > 5:
            rating = None
    except (TypeError, ValueError):
        rating = None
    reviews = client.get("totalReviews")
    try:
        reviews = int(reviews) if reviews is not None else None
    except (TypeError, ValueError):
        reviews = None
    applicants = node.get("totalApplicants")
    try:
        applicants = int(applicants) if applicants is not None else None
    except (TypeError, ValueError):
        applicants = None
    competition = ("unknown" if applicants is None else
                   "low" if applicants < 10 else "medium" if applicants < 30 else "high")
    skills = node.get("skills") if isinstance(node.get("skills"), list) else []
    skill_names = sorted({str(s.get("name") or "").strip() for s in skills if isinstance(s, dict) and s.get("name")})
    published = node.get("publishedDateTime") or node.get("createdDateTime") or ""
    return {
        "source": "upwork_api",
        "source_origin": "upwork_official_graphql_api",
        "external_id": external_id,
        "title": title[:300],
        "client_name": "Upwork client (name not provided in search result)",
        "description": description[:12000],
        # The API search response does not provide a verified browser URL.
        # Keep it blank rather than manufacturing a marketplace link.
        "source_url": "",
        "budget_min": budget_min,
        "budget_max": budget_max,
        "currency": currency,
        "required_skills": skill_names,
        "deadline": "",
        "job_type": job_type,
        "industry": str(node.get("category") or node.get("subcategory") or "")[:100],
        "estimated_hours": None,
        "competition_level": competition,
        "client_rating": rating,
        "client_reviews": reviews,
        # Payment verification is not included in the documented public search result fields.
        "client_payment_verified": None,
        "published_at": published,
        "provider_record_id": external_id,
        "provider_ciphertext": str(node.get("ciphertext") or ""),
        "applicant_count": applicants,
    }


async def _graphql_request(access_token: str, search_term: str, limit: int, cursor: str | None) -> dict[str, Any]:
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    after = cursor or "0"
    payload = {
        "query": SEARCH_QUERY,
        "variables": {"filter": {
            "searchExpression_eq": search_term,
            "pagination_eq": {"after": after, "first": limit},
        }},
    }
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
            response = await client.post(GRAPHQL_URL, json=payload, headers=headers)
            if response.status_code == 429:
                # One bounded retry only; do not turn a user action into a retry storm.
                try:
                    delay = min(2.0, max(0.0, float(response.headers.get("Retry-After", "1"))))
                except (TypeError, ValueError):
                    delay = 1.0
                await asyncio.sleep(delay)
                response = await client.post(GRAPHQL_URL, json=payload, headers=headers)
    except httpx.RequestError as exc:
        raise HTTPException(502, "Could not reach the Upwork marketplace API. Retry later.") from exc
    if response.status_code in (401, 403):
        raise HTTPException(409, "Upwork rejected this token or its approved scopes. Reconnect the account or request the required read-only marketplace scope.")
    if response.status_code == 429:
        raise HTTPException(429, "Upwork rate limit reached. Wait before searching again.")
    if response.status_code >= 500:
        raise HTTPException(502, "Upwork marketplace API is temporarily unavailable.")
    if response.status_code >= 400:
        raise HTTPException(502, f"Upwork marketplace API returned HTTP {response.status_code}.")
    try:
        body = response.json()
    except ValueError as exc:
        raise HTTPException(502, "Upwork returned a non-JSON GraphQL response.") from exc
    if not isinstance(body, dict):
        raise HTTPException(502, "Upwork returned an unexpected GraphQL response format.")
    if body.get("errors"):
        # Avoid exposing raw provider payloads, which can contain account metadata.
        first = body["errors"][0] if isinstance(body["errors"], list) and body["errors"] else {}
        message = str(first.get("message") or "GraphQL query failed") if isinstance(first, dict) else "GraphQL query failed"
        if "permission" in message.lower() or "scope" in message.lower() or "oauth" in message.lower():
            raise HTTPException(409, "Upwork API scope or permission is insufficient for marketplace job search.")
        raise HTTPException(502, "Upwork rejected the marketplace search query. Check the current API schema and approved scopes.")
    return body


async def fetch_upwork_opportunities(db: Session, user_id: str, search_term: str,
                                     limit: int = 20, cursor: str | None = None) -> dict[str, Any]:
    credential = db.scalar(select(MarketplaceCredential).where(
        MarketplaceCredential.user_id == user_id,
        MarketplaceCredential.provider == "upwork",
    ))
    if not credential:
        raise HTTPException(409, "Connect your Upwork account before searching marketplace opportunities.")
    if credential.status == "reauthorization_required":
        raise HTTPException(409, "Upwork authorization has expired. Reconnect your account.")
    expires = _aware(credential.token_expires_at)
    if expires and expires <= datetime.now(timezone.utc).replace(microsecond=0):
        await refresh_upwork_token(db, user_id)
        db.refresh(credential)
    tokens = load_tokens(credential)
    if not tokens["access_token"]:
        raise HTTPException(409, "Upwork access token is unavailable. Reconnect your account.")
    body = await _graphql_request(tokens["access_token"], search_term, limit, cursor)
    result = (body.get("data") or {}).get("marketplaceJobPostingsSearch")
    if not isinstance(result, dict):
        raise HTTPException(502, "Upwork response did not contain marketplace search results.")
    edges = result.get("edges") if isinstance(result.get("edges"), list) else []
    items = []
    for edge in edges:
        node = edge.get("node") if isinstance(edge, dict) else None
        if isinstance(node, dict):
            mapped = map_upwork_job(node)
            if mapped:
                items.append(mapped)
    page_info = result.get("pageInfo") if isinstance(result.get("pageInfo"), dict) else {}
    return {
        "items": items,
        "total_count": int(result.get("totalCount") or 0),
        "next_cursor": page_info.get("endCursor") if page_info.get("hasNextPage") else None,
        "has_more": bool(page_info.get("hasNextPage")),
        "returned": len(items),
    }

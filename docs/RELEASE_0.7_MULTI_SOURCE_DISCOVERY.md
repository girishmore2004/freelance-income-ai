# Release 0.7 — Multi-Source Opportunity Discovery

## What changed
- Source registry supports `rss` (RSS and Atom through feedparser) and `json_api` (user-configured public JSON feeds).
- JSON adapter accepts a top-level array or arrays under `jobs`, `results`, `items`, or `data`.
- JSON item fields are normalized from common keys: title/name, description/summary/content,
  url/link/job_url, id/guid, company/client, skills/tags, budget_min/budget_max,
  currency, deadline/due_date, type/job_type, industry, published_at/created_at.
- Both source types require HTTPS, public DNS resolution, reject non-public IPs, do not follow redirects,
  and JSON responses are capped at 5 MB.
- Canonical URL fingerprinting strips common UTM parameters and fragments. It deduplicates the
  same listing found through different feeds for the same user.
- Existing opportunities retain the original record while `last_seen_at`, duplicate count and
  source-origin list are updated.
- Opportunity list API supports source, minimum score and freshness filters.
- UI allows configuring RSS/Atom or public JSON sources and displays provenance and last-seen metadata.
- Background RQ and n8n discovery process both configured source types.

## Supported public JSON response shape
```json
{
  "jobs": [
    {
      "id": "listing-123",
      "title": "Python automation developer",
      "description": "Build and maintain a Python workflow...",
      "url": "https://jobs.example/listing-123",
      "company": "Example client",
      "skills": ["Python", "FastAPI"],
      "budget_min": 10000,
      "budget_max": 25000,
      "currency": "INR",
      "published_at": "2026-11-01T09:00:00Z"
    }
  ]
}
```

## API
- `POST /api/v1/sources` accepts `source_type` of `rss` or `json_api`.
- `GET /api/v1/sources` includes source type.
- `POST /api/v1/discovery/enqueue` scans all enabled sources asynchronously.
- `POST /api/v1/integrations/n8n/discover` scans all enabled sources through the authenticated webhook.
- `GET /api/v1/opportunities?source=json_api&min_score=50&fresh_days=7` filters results.
- Opportunity records include `first_seen_at`, `last_seen_at`, `published_at`,
  `duplicate_count`, `source_origins` and `source_fingerprint`.

## Important limits
This is a generic public JSON adapter, not a marketplace-specific integration. It does not bypass
authentication, paywalls, CAPTCHAs, robots restrictions or marketplace terms. Do not use it to
scrape sites that prohibit automated access. Use official APIs or feeds and follow each provider's
terms. Private API keys and authenticated connectors are not included in this release.

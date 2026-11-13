# Release 0.9 — Source Health, Retry Policy and Evidence Provenance

## Source health
Each saved RSS/Atom or public JSON source now records:
- health status: unknown, healthy, degraded or failing
- consecutive failure count
- total number of items observed
- last checked and last successful timestamps
- last fetch latency in milliseconds
- next retry timestamp and last error

A successful scan resets the consecutive failure count and retry time. A failed connector scan increments the failure count and schedules exponential retry delays: 2, 4, 8, 16... minutes, capped at 24 hours. A source with a future retry timestamp is skipped during queued scans. This prevents a broken source from being hammered on every scheduled run. Manual disabling remains available.

Health is based on connector fetch/parse success, not on the quality or truthfulness of the opportunities returned.

## Evidence provenance
Client research records now store:
- `source_host`: hostname parsed from the HTTPS evidence URL (blank for notes without URLs)
- `evidence_hash`: SHA-256 digest of the claim, evidence URL and evidence type
- existing confidence, evidence type, URL and creation timestamp

The digest helps detect whether the recorded claim/URL/type has changed. It is not a digital signature, proof of authorship, proof that the URL is authentic, or independent verification of the claim. Confidence remains the user's own assessment.

## Database migrations
- `0008_source_health` — source health and retry metadata
- `0009_evidence_provenance` — client research source host and evidence digest

Upgrade:
```bash
cd backend
alembic upgrade head
```

## UI
The Sources tab displays source health, failure count, total items, last latency, last check, retry time and last connector error. The Research tab displays evidence type, confidence, source host, capture date and a shortened digest.

## API
`GET /api/v1/sources` now returns health fields with each source. Existing source create, enable/disable and queue discovery routes remain compatible.
`POST /api/v1/research` returns `source_host` and `evidence_hash`; `GET /api/v1/research` includes these fields for each evidence record.

## Boundaries
- Public JSON API and RSS/Atom remain user-configured generic feeds, not official integrations with Upwork, Freelancer or LinkedIn.
- This release does not crawl arbitrary evidence URLs. Users record evidence they have personally reviewed.
- No client identity, payment history or reputation claim is independently verified by the evidence digest.
- No marketplace application, outbound message or payment is sent automatically.

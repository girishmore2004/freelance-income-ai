# Release 0.6 — Client Research & Risk Intelligence

## Delivered
- Structured evidence types: platform profile, client history, contract, payment terms,
  public review, user note and other.
- Evidence is linked to a specific opportunity and stores its source URL and user-set
  confidence label.
- Persisted risk-screening reports with score, level, evidence coverage, findings and
  questions to ask.
- Risk rules look for upfront fees, off-platform payment requests, unpaid tests,
  credential/OTP requests and unusually strong earning promises.
- UI supports attaching evidence and running risk screening per opportunity.

## Important interpretation
This is a deterministic screening aid, not a background check, fraud determination,
or guarantee of safety. The score is based on keywords in the listing and user-entered
evidence. False positives and false negatives are possible. Confidence labels are
user-supplied and are not independently verified. No external client website is
scraped or fetched automatically.

`insufficient_data` means there is not enough evidence to call the client low risk.
A low risk score must never be interpreted as a guarantee.

## Migration
```bash
cd backend
alembic upgrade head
```

## New API endpoints
- `POST /api/v1/research` — save evidence linked to an opportunity.
- `GET /api/v1/research?opportunity_id=<id>` — list evidence.
- `POST /api/v1/research/assess` — generate and persist a risk report.
- `GET /api/v1/research/assessments?opportunity_id=<id>` — list saved reports.

## Evidence payload example
```json
{
  "opportunity_id": "YOUR_OPPORTUNITY_ID",
  "client_name": "Client name",
  "evidence_type": "platform_profile",
  "claim": "Profile shows a public payment verification badge.",
  "evidence_url": "https://marketplace.example/client/profile",
  "confidence": "medium"
}
```
Use only evidence you personally checked and are permitted to record.

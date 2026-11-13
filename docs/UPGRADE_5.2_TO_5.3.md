# Upgrade guide: v5.2.0 to v5.3.0

## Release scope
v5.3.0 adds profile-aware opportunity intelligence, a persisted shortlist/review workflow, and a dedicated Opportunity Intelligence workspace. It recalculates fit using the current profile when listing ranked intelligence results, and includes explanations, profile warnings and source provenance.

## Important marketplace integration status
This release does **not** claim live Upwork, Freelancer.com, Fiverr or LinkedIn API connectivity. Existing marketplace settings remain readiness metadata. Selecting `official_api_configured` does not connect an account, validate credentials, or create an API session. Provider-specific clients require provider approval/credentials, documented endpoint verification, secure per-user token storage and integration tests. No scraping, browser automation or automated applications are introduced.

Existing RSS/Atom and permitted public JSON discovery remains the actual automated discovery mechanism. Respect each source's terms, rate limits and robots/API restrictions.

## Before upgrading
1. Back up PostgreSQL and verify the backup.
2. Create a release branch and review CI.
3. Confirm the database is at Alembic revision `0026_client_cost_entries`.

## Upgrade
Run once after deploying compatible code:

```bash
cd backend
alembic upgrade head
```

Migration: `0027_opportunity_reviews`.

## New endpoints
- `GET /api/v1/opportunity-intelligence` — profile-aware ranked opportunities with explanation, eligibility warnings, provenance and saved review state. Supports `limit`, `min_score`, `max_age_days`, `source` and `decision`.
- `POST /api/v1/opportunities/{opportunity_id}/review` — save shortlist decision, notes and next action date.
- `GET /api/v1/opportunities/reviews` — list saved review records.

Allowed review decisions: `saved`, `interested`, `proposal_ready`, `revisit`, `dismissed`.

## UI
Open `/opportunity-intelligence` after sign-in. Existing `/marketplaces` remains the provider readiness and manual application tracking page. The dashboard includes a link to the new intelligence workspace.

## Safety and human approval
- Profile scoring is deterministic and recalculated from current profile data for intelligence results.
- Client risk screening remains a separate evidence-backed manual action. It is not a background check or fraud determination.
- Proposal generation creates a draft only.
- Proposal approval and application submission remain explicit manual actions.
- No external marketplace action is performed by this release.

## Rollback
Prefer application rollback while retaining the additive review table. Downgrade drops shortlist/review notes:

```bash
alembic downgrade 0026_client_cost_entries
```

Only downgrade if the review data is disposable and a verified backup exists. Do not run migrations concurrently across API replicas.

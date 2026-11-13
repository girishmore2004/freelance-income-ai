# Upgrade: v5.29.0 to v5.30.0

## Changes

- Adds read-only endpoint `GET /api/v1/analytics/delivery-quality?minimum_sample=3`.
- Adds client feedback and delivery quality analytics to the Analytics page.
- Uses existing `DeliverableAcceptanceEvent`, `DeliveryAuditEvent`, `DeliverableRevision`, `ProjectDeliverable`, `Project`, and `ScopeChangeRequest` records.
- No database migration and no new runtime dependency are required.

## Deployment

1. Back up the production database.
2. Replace the repository files with this release or apply the version-control diff.
3. Deploy the backend and frontend using the existing deployment configuration.
4. Confirm `/health` and authenticate in the application.
5. Open Analytics and verify the Client feedback and delivery quality section.
6. Call `GET /api/v1/analytics/delivery-quality?minimum_sample=3` with a valid bearer token.

## Data interpretation

Acceptance rates are suppressed below the requested sample threshold. Acceptance cycle time is only computed from an explicit `delivery_recorded` audit event followed by an explicit client decision. Revision links are version/time associations, not causal proof. Old revision origins are not guessed. Scope changes are reported separately.

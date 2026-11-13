# Upgrade 5.28.0 → 5.29.0

## Changes
- Adds authenticated `GET /api/v1/analytics/delivery-bottlenecks`.
- Adds dependency-based task review signals and deliverable revision-activity summaries.
- Adds dashboard tables for candidate tasks and revision counts.
- No database migration and no new runtime dependency.

## Deployment
1. Back up the database as part of the normal release process.
2. Deploy the backend source.
3. Deploy the frontend source.
4. Sign in and open Business Intelligence.
5. Review task candidates and revision history; do not treat the score as a probability or revision count as proof of rework.

## Compatibility
Existing task, dependency, deliverable and revision rows are read-only inputs. Missing dates, dependencies or revision snapshots remain unknown. No task dates, estimates, project statuses or client messages are changed.

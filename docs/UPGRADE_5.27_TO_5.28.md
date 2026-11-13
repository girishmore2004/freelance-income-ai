# Upgrade 5.27.0 → 5.28.0

## Purpose

Release 5.28.0 adds adaptive, evidence-based task-effort suggestions using the account's own completed tasks and task-linked time entries.

## Changes

- New service: `backend/app/services/adaptive_effort.py`.
- New authenticated endpoint: `GET /api/v1/analytics/adaptive-effort`.
- Analytics page shows recommended effort, historical range, sample size, confidence and matched examples.
- No database migration and no new dependency.
- Existing estimates, schedules, contractual due dates and client commitments are never changed by this feature.

## Estimation method

1. Use only tasks with status `done` or `completed` and positive task-linked recorded time.
2. Compare task title and description using deterministic token Jaccard similarity.
3. Keep up to 12 closest records meeting the similarity threshold.
4. Recommend the median of their recorded hours and show the 25th–75th percentile range.
5. Confidence is based on sample count and relative dispersion; fewer than two similar examples yields no numeric suggestion.

## API

`GET /api/v1/analytics/adaptive-effort`

The endpoint is authenticated and queries `ProjectTask` and `TimeEntry` using the current user's ID. The service is read-only.

## Deployment

No migration is required. Deploy backend and frontend source together. Verify the endpoint with an authenticated account containing completed, time-tracked tasks. If there is insufficient history, the API intentionally returns null recommendations.

## Limitations

Logged time may understate true effort when time tracking is incomplete. Text overlap is a heuristic and not semantic classification. Review matched examples before using a suggested number. Suggestions never update task estimates automatically.

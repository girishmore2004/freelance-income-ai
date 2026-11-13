# Upgrade 5.22.0 → 5.23.0

## Calendar-aware availability and deadline review

- Adds user-entered unavailable-time blocks for leave, holidays and personal commitments.
- Adds `GET /api/v1/analytics/calendar-planning?horizon_weeks=8`.
- Adds `POST /api/v1/calendar/availability-blocks` and `DELETE /api/v1/calendar/availability-blocks/{block_id}`.
- Reduces weekly capacity by unavailable hours and highlights task/milestone due-date collisions.
- No external calendar integration, automatic rescheduling, client messaging or deadline changes.

## Database

Run `alembic upgrade head` to apply migration `0031_calendar_availability_blocks`.

## API example

```json
{"date":"2026-12-24","unavailable_hours":8,"kind":"holiday","note":"Holiday"}
```

Kinds: `leave`, `holiday`, `personal`. Dates must be today or later; hours must be greater than 0 and at most 24.

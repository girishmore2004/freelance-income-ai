# Release 1.1 — Delivery & Revenue Intelligence

## Delivery planning
- `GET /api/v1/delivery/plan/{project_id}` returns suggestions based on the project's current tasks and milestones.
- Suggestions include kickoff/dependency confirmation, QA/client review, documentation/handover and milestone/scope confirmation where gaps are detected.
- This is a deterministic checklist assistant, not an LLM-generated project plan. It does not mutate project data. A user must decide what to create.

## Time tracking
- `POST /api/v1/time-entries` records project work.
- `GET /api/v1/time-entries` lists entries, optionally filtered by `project_id`.
- Fields: project, optional task, ISO work date, minutes, description, billable flag, hourly rate and currency.
- Entries are scoped to the authenticated user and the selected project/task ownership is checked.
- Billable value is calculated as minutes / 60 × hourly rate. It is an estimate, not an invoice.

## Finance and reminders
- `GET /api/v1/finance/summary` reports paid revenue, outstanding invoices, overdue invoices and invoices due within 14 days.
- It surfaces reminders in the UI; it does not send email or Telegram reminders automatically.
- Forecast values include recorded unpaid invoices and assume collection; they are not guaranteed cash receipts.

## Proposal analytics
- `GET /api/v1/analytics/proposals` summarizes manually recorded feedback outcomes.
- Win rate is wins divided by wins plus lost/rejected/no-response outcomes.
- It is not marketplace-confirmed analytics and excludes unresolved/not-relevant/client-risk outcomes from the denominator.

## Migration
Run from `backend`:
```bash
alembic upgrade head
```
Migration `0010_delivery_revenue` creates `time_entries`.

## API examples
```bash
curl -X POST http://localhost:8000/api/v1/time-entries \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"project_id":"PROJECT_ID","work_date":"2026-11-12","duration_minutes":90,"description":"API implementation","hourly_rate":1200,"currency":"INR","billable":true}'
```

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/v1/finance/summary
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/v1/analytics/proposals
```

## Safety and limitations
- No invoice is automatically sent, and no client is contacted.
- No automatic task or milestone creation occurs from a generated delivery plan.
- No scheduled external reminder service is configured by this release.
- Use accurate work dates and rates; do not treat billable value as money received.

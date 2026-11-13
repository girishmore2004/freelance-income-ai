# Usage reporting and abuse-event retention — 3.6

## Usage report
`GET /api/v1/usage/ai/report?days=30` returns only the authenticated user's events, grouped by operation/provider and daily call count. Character counts are shown as recorded. Token usage and monetary costs are intentionally omitted because the current provider abstraction does not expose verified, consistent token/pricing metadata.

## Abuse telemetry retention
The new cleanup command uses a 90-day default retention window and is dry-run by default:

```bash
cd backend
python scripts/cleanup_abuse_events.py
python scripts/cleanup_abuse_events.py --retention-days 180
```

Only use the destructive mode after reviewing the preview:

```bash
python scripts/cleanup_abuse_events.py --retention-days 90 --apply
```

Retention applies to abuse telemetry only. It does not delete AI usage history, client emails, workflow checkpoints, invoices, or other business records. Back up the database before destructive retention operations.

## Operational boundaries
This release does not add alert delivery, provider token metering, a cost ledger, or automatic anomaly blocking. Rate limiting and account quotas remain the enforcement mechanisms. No migration is required.

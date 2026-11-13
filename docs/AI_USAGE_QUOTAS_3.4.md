# AI usage quotas and account abuse signals — 3.4

## What is metered

The current release meters successful AI-backed operations in three authenticated flows:

- Proposal generation (`POST /api/v1/proposals/generate`)
- Client email reply drafting (`POST /api/v1/emails/{email_id}/draft`)
- Business coach questions (`POST /api/v1/coach/ask`)

Rules-based fallback responses are not recorded as successful AI usage. The quota is checked before the model call. PostgreSQL locks the authenticated user's row during the check so concurrent requests for one account do not all pass the same remaining quota.

## Defaults and configuration

```dotenv
AI_QUOTA_DAILY_CALLS=20
AI_QUOTA_MONTHLY_CALLS=300
```

Both values must be integers from 1 through 1,000,000. Counters use UTC day and UTC calendar-month boundaries. Existing Redis request limits remain separate and continue to limit request bursts.

## Usage endpoint

`GET /api/v1/usage/ai` returns daily/monthly calls, limits and remaining calls for the authenticated account. It never returns another user's usage.

The event stores provider name and input/output character counts. It intentionally does not estimate tokens or money. OpenAI token usage and Ollama token counters are not yet normalized across every flow, and model pricing can change. A cost display must not be added until the provider usage and pricing source are both verified.

## Abuse signal

Quota exhaustion creates an `abuse_events` row (`ai_quota_exhausted`) scoped to the user. Redis rate-limit middleware separately logs rate-limit events. This release does not yet provide email/SMS alert delivery, an admin dashboard, or persistent audit rows for anonymous IP bursts. Do not describe it as a complete SIEM or intrusion-detection system.

## Migration and rollback

Run `alembic upgrade head`. Migration `0021_ai_usage_quotas` adds `ai_usage_events` and `abuse_events`. Back up PostgreSQL first. Downgrade with `alembic downgrade 0020_agent_workflow_operations` only if rolling back the application and after deciding whether the usage history may be discarded.

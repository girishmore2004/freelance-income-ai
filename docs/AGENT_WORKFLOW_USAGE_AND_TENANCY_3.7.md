# Agent workflow usage and tenant boundaries — 3.7

## Agent workflow quota accounting
New non-idempotent agent workflow starts now call the existing account quota gate and record one usage event with operation `agent_workflow:<workflow_type>` and provider `workflow`. Idempotent replays do not consume another quota event. This measures initiated workflow operations only; it does not claim to count internal LLM calls, embeddings, tokens, or provider costs.

## Tenant boundaries
The agent workflow detail route first resolves the workflow by both workflow ID and authenticated user ID. Checkpoints are queried only after the owner-scoped parent run is found. Added regression tests cover owner-vs-other-account workflow visibility and usage history isolation.

## Remaining work
This release does not yet provide complete tenant-isolation proof for email, portfolio documents/chunks, deliverables/revisions, invoice schedules, time entries, reminders, OAuth records, or marketplace connections. Each resource still needs route-level API tests against PostgreSQL. Full staging journey, Redis outage/recovery, frontend E2E, dependency audit, k6 baseline, and backup/restore drill remain outstanding.

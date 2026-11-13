# Release 2.4 — Durable Multi-Agent Business Workflows

## What changed

Release 2.4 adds a read-only LangGraph workflow that coordinates specialist analysis across existing account records:

1. Context loader — tenant-scoped snapshot of profile, opportunities, research, projects, tasks, deliverables, invoices and feedback.
2. Opportunity matching agent — reuses the existing deterministic scoring service.
3. Client research agent — summarizes saved evidence labels and clearly disclaims independent verification.
4. Delivery agent — summarizes active projects, open tasks and overdue tasks/deliverables.
5. Finance agent — summarizes paid and outstanding invoice records and flags overdue invoices.
6. Business planner — combines evidence-linked recommendations into a prioritized action plan.

Each node stores a JSON checkpoint in PostgreSQL before the graph advances. A failed workflow can be retried up to three total attempts; completed nodes are restored from the latest checkpoint and skipped. A worker that remains in `running` for more than 20 minutes is treated as stale and can be recovered from the last committed checkpoint. The API uses tenant-scoped queries and a per-user idempotency key.

## API

- `POST /api/v1/agent-workflows` — start a workflow. Body: `workflow_type` (`business_review`, `opportunity_plan`, `delivery_review`, `finance_review`) and optional `idempotency_key`.
- `GET /api/v1/agent-workflows` — list the current user's runs.
- `GET /api/v1/agent-workflows/{id}` — detail and ordered checkpoints.
- `POST /api/v1/agent-workflows/{id}/retry` — retry a failed run if fewer than three attempts have been made.

The workflow type controls which recommendation categories are returned: `business_review` includes all, while the other three filter the action list to opportunity, delivery or finance recommendations. The shared specialist stages still run to produce a consistent checkpointed snapshot. The workflow requires the existing Redis/RQ worker. Start it from `backend` with `rq worker freelance-income-ai`.

## Safety

This release is analysis-only. It does not send emails, submit marketplace proposals, change project/task states, deliver files, issue invoices, collect payments or transfer money. Recommendations cite source record type and ID and always require a human decision before any external action.

Currency totals are not converted across currencies. Research counts saved confidence labels and URLs; it does not verify external claims. Matching uses the existing deterministic score, not an LLM judgement.

## Database

Alembic migration `0019_durable_agent_workflows` creates `agent_workflow_runs` and `agent_workflow_checkpoints`. Run `alembic upgrade head` after backing up the database.

# Release 2.6 — Agent Operations & Evaluation

## Added
- User-scoped cancellation for queued and running agent workflows.
- Cancellation fencing: a node already executing may finish local computation, but cannot commit a later checkpoint or mark the run complete.
- Structured error labels (`error_code`, `last_error_node`) alongside the existing error message.
- Per-user metrics for the latest 200 runs: status counts, measured agent-step count, mean measured step duration and per-agent execution counts.
- Offline RAG citation evidence-ID precision/recall/F1 helper for labelled evaluation fixtures; it measures ID overlap only, not semantic grounding.
- Explicit, user-scoped retention cleanup for terminal runs older than a selected period. Dry-run is the default; 30–3650 days. Queued/running runs are never selected.
- Workflow page cancellation controls and compact metrics.

## API
- `POST /api/v1/agent-workflows/{workflow_id}/cancel`
- `GET /api/v1/agent-workflows/metrics/summary`
- `POST /api/v1/agent-workflows/retention/cleanup` with `{"older_than_days":90,"dry_run":true}`

## Safety
All endpoints are user-scoped. Cancellation fences durable writes but is not an instant kill of a blocking model call. Cleanup is dry-run by default and only selects completed, failed or cancelled runs with a finish time. No external client action is executed.

## Not claimed complete
A production RAG benchmark corpus with human labels and semantic entailment checks, live PostgreSQL/Redis/RQ integration, live LangGraph execution and browser E2E still require dedicated fixtures and provisioned services. Operational latency is not an AI answer-quality score.

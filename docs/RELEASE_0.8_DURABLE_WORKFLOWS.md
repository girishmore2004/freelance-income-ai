# Release 0.8 — Durable Multi-Agent Workflows

## Goal
Turn the existing specialist-agent chain into an auditable workflow that survives worker restarts, stores completed stages in PostgreSQL, and pauses for explicit human approval before any external action.

## Workflow
1. **Matching** — evaluates the opportunity against the saved profile and stores the score breakdown.
2. **Research** — summarizes evidence already saved for the opportunity. It does not claim to independently verify a client.
3. **Pricing** — calculates an advisory floor from the user's configured hourly rate, estimated hours and minimum budget. It is not a binding quote.
4. **Proposal** — drafts using verified profile facts and the existing safe-template fallback.
5. **Human approval** — creates a proposal-hash-bound approval record and changes workflow status to `awaiting_approval`.
6. **Resume** — after the user approves the exact proposal, the user explicitly resumes the workflow. It becomes `completed` with `external_submission=not_performed`.

## Persistence
- `workflow_runs` stores workflow identity, status, current stage, proposal/approval links and latest serialized state.
- `workflow_checkpoints` stores ordered state snapshots after completed LangGraph nodes.
- On retry, completed matching, research and pricing stages are restored from the last checkpoint and skipped.
- Proposal creation is idempotent: an existing proposal linked to a workflow is not generated a second time.
- The approval decision and workflow status are updated in one database transaction.
- Failed runs and runs stuck in `running` for more than 20 minutes can be retried. Runs with an existing proposal cannot be blindly retried.

This release uses SQLAlchemy-managed database tables as the durable checkpoint store around LangGraph node execution (PostgreSQL in Docker deployments; SQLite can be used for local development). It does **not** claim to use LangGraph's official `PostgresSaver` implementation.

## API
- `POST /api/v1/workflows` — queue an opportunity workflow.
  ```json
  {"opportunity_id":"<your-opportunity-id>","proposed_price":15000,"currency":"INR"}
  ```
- `GET /api/v1/workflows` — list the user's workflows.
- `GET /api/v1/workflows/{workflow_id}` — retrieve state and checkpoint history.
- `POST /api/v1/workflows/{workflow_id}/resume` — complete the human-approved pause after verifying the exact proposal hash.
- `POST /api/v1/workflows/{workflow_id}/retry` — retry a failed workflow from its last persisted stage.
- Existing `POST /api/v1/approvals/{approval_id}/decision` now synchronizes the workflow to `approved` or `rejected`.

## Status lifecycle
`queued → running → awaiting_approval → approved → completed`

Alternative terminal paths: `rejected`, `failed`. Only `failed` runs without a proposal can be retried.

## Safety boundaries
- The proposal is never submitted to a marketplace by this workflow.
- The resume endpoint records that approval was confirmed; it does not send emails, apply to jobs, accept contracts or transfer money.
- Approval remains bound to the exact proposal text, price and currency hash.
- Editing a proposal invalidates any previous approval hash.
- Client evidence remains user-supplied and is labeled with its saved confidence; no fabricated verification is introduced.

## Run locally
```bash
cd backend
alembic upgrade head
pytest -q
```

The workflow needs Redis and the RQ worker:
```bash
docker compose up --build -d
```
Open the Opportunities tab, choose **Run full AI workflow**, then inspect progress in the Workflows tab. Review the generated proposal in Proposals/Approvals. Approve or reject it, then return to Workflows and resume an approved workflow.

## Operational notes
- Keep the API and worker on the same PostgreSQL database and Redis queue.
- Back up PostgreSQL; workflow state and checkpoints are application data.
- If the worker stops, a failed workflow can be retried from its last committed node checkpoint.
- This is a single-user oriented workflow feature; production multi-tenant security review, concurrency stress tests and disaster recovery drills remain required.

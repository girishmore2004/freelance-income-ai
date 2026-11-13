# Architecture — Release 0.8

- Next.js frontend calls FastAPI using bearer JWT.
- FastAPI owns user-scoped data, opportunity intake, scoring, proposal and approval records, workflows and project operations.
- PostgreSQL is the persistent source of truth.
- Redis/RQ executes asynchronous discovery and multi-agent workflow jobs.
- LangGraph runs matching → research evidence summary → pricing advice → proposal drafting.
- `workflow_runs` stores current workflow state and status; `workflow_checkpoints` stores ordered per-node snapshots. These SQLAlchemy tables provide the durable checkpoint mechanism in this release.
- The workflow pauses in `awaiting_approval` after creating a proposal and hash-bound approval record. Approval decisions update the workflow transactionally. A separate resume action completes the workflow without submitting anything externally.
- Failed workflow retries restore the latest persisted node state and skip completed stages.
- Discovery adapters support manual intake, RSS/Atom and user-configured public JSON feeds with URL-based deduplication and provenance.
- Ollama is the default local model; OpenAI is optional and may incur API charges.
- Client research summarizes saved evidence; it does not independently verify identity or reputation.
- Portfolio search supports embeddings/pgvector where configured and lexical fallback.
- Projects, tasks, milestones and invoice records support delivery administration. Invoices do not move money.

## Trust boundaries
Marketplace listings, JSON/RSS entries and client messages are untrusted input. Proposal generation uses factual profile fields and safe fallback. External submission, email sending, contract acceptance and payments are not performed by the workflow. Approval is bound to the exact proposal content and commercial terms.

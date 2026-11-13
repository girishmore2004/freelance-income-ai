# Release 2.5 — Proposal and Client Communication Specialist Agents

## What changed

Release 2.5 extends the v2.4 durable LangGraph workflow with two specialist stages.

### Proposal strategist
- Runs for `business_review` and `opportunity_plan`.
- Reuses the existing `proposal_agent` and profile-aware opportunity match scores.
- Prepares previews for up to three opportunities with match scores of at least 60.
- Uses profile facts and the listing description under the existing untrusted-input guardrail.
- Does not invent a proposed price. A client's `budget_max` is shown only as a budget ceiling reference, never as the freelancer's quote.
- Uses the existing safe template fallback when the configured model is unavailable or exceeds the bounded 40-second call.
- Preview content is returned in the workflow result only. It is not persisted as a Proposal record and is not submitted externally.

### Client communication planner
- Runs for `business_review`.
- Reuses the existing rule-based message urgency/sentiment indicators, follow-up cadence logic, project matching and portfolio RAG context builder.
- Reviews up to 30 recent saved emails and returns up to 30 recommendations.
- Shows email record IDs, urgency reasons, optional follow-up suggestions, project matches and retrieved portfolio source IDs.
- Does not create an EmailDraft or FollowUpReminder and never sends a message. Users can use the existing email workspace to create, edit and request approval for a reply.

### Workflow observability and privacy
- Each completed agent trace now includes `duration_ms`.
- Checkpoint detail endpoint returns state keys and aggregate record counts rather than full raw state snapshots.
- Workflow state still stores bounded account context for resume. Protect database access and backups.

## API

No new endpoints are required. Existing endpoints return the extended result:
- `POST /api/v1/agent-workflows`
- `GET /api/v1/agent-workflows`
- `GET /api/v1/agent-workflows/{workflow_id}`
- `POST /api/v1/agent-workflows/{workflow_id}/retry`

`business_review` includes all stages. `opportunity_plan` includes proposal strategy. `delivery_review` and `finance_review` skip proposal and communication stages.

## Safety
- All generated content is a draft preview.
- No proposal, email, reminder or approval record is created by the workflow.
- No marketplace submission, client email, delivery, invoice or payment action occurs.
- Human review and the existing exact-content approval hashes remain required for external actions.

# Release 1.5 — Communication Intelligence

## Features
- Explainable rule-based sentiment and urgency signals with evidence terms and disclaimers.
- Project matching suggestions based on message/project title, client and description token overlap.
- Explicit project-link confirmation endpoint; no silent auto-linking.
- Context-aware email drafts using profile, explicitly linked project, recent messages from the same sender, and retrieved portfolio chunks.
- Retrieval uses the existing rank_chunks path, with optional query embeddings and lexical fallback.
- Draft metadata includes retrieval source labels, retrieval mode, generation mode and a grounding warning.
- LLM prompt prohibits invented project facts, achievements, prices, dates, guarantees and unsupported claims.
- Safe clarification template fallback if model generation fails.
- Follow-up cadence recommendations use the user's configured profile timezone and explicit in-app reminder creation; no automatic email send.

## New API
- `GET /api/v1/emails/{email_id}/intelligence`
- `PATCH /api/v1/emails/{email_id}/link-project`
- `POST /api/v1/emails/{email_id}/create-follow-up`
- Existing `POST /api/v1/emails/{email_id}/draft` is now asynchronous and context-aware.

## Database
- Migration `0013_communication_intelligence.py`, down_revision `0012_email_provider_oauth`.
- Adds message sentiment/urgency evidence and suggested project fields.
- Adds email draft context source and generation metadata.

## Safety and limitations
- Sentiment/urgency are heuristic keyword indicators, not definitive emotional analysis.
- Project association requires user confirmation.
- Follow-up suggestions are advisory; the user must explicitly create a reminder.
- Outbound communication remains approval-gated; no automatic send is added.
- AI-generated email text may still contain errors. Inspect every claim before approval.
- Embedding retrieval is attempted with a 5-second timeout; lexical retrieval remains available, including when vector dimensions are incompatible.
    - LLM drafting is bounded by a 35-second timeout; the safe template is used when generation fails or times out.
- Portfolio retrieval is limited to the configured candidate bound (maximum 2,000 chunks per request).

## Verification status
- See `docs/RELEASE_1.5_VERIFICATION.md` for exact test and static-check outcomes.

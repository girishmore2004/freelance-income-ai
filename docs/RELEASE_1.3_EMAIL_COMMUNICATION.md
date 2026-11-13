# Release 1.3 — Email intake & client communication

## Delivered
1. `ClientEmail` stores inbound messages per user, with optional links to an owned opportunity or project. Provider/external ID deduplication is supported when an external ID is supplied.
2. Classification labels messages as payment, project enquiry, project update, meeting, or general, with a conservative high/normal priority marker. This is rule-based, not an LLM confidence claim.
3. Reply drafts are generated from the sender, subject and generic clarification language. The draft does not invent portfolio claims, delivery dates, prices, or commitments.
4. Draft approval lifecycle: `draft` → `pending_approval` → `approved_not_sent` or `rejected`. Approval stores a SHA-256 hash of the exact approved subject and body. Approval is not sending.
5. Follow-up reminders are stored and can be marked complete. This release does not yet schedule push/email delivery of reminders.
6. Inbox UI supports manual intake, drafting, approval, and reminders.

## Provider limitations
Gmail and Outlook fields are labels only in this release. There is no OAuth flow, token storage, mailbox polling, webhook subscription, or outbound provider send. Do not treat manual import as a connected inbox. The Gmail app can be connected in ChatGPT separately, but that does not connect this standalone application.

## API
- `POST /api/v1/emails/intake` — authenticated manual intake.
- `GET /api/v1/emails` — current user's inbox.
- `POST /api/v1/emails/{email_id}/draft` — create a reply draft.
- `GET /api/v1/email-drafts` — list drafts.
- `POST /api/v1/email-drafts/{draft_id}/request-approval` — request review.
- `POST /api/v1/email-drafts/{draft_id}/decision` — approve/reject; approved means saved, not sent.
- `POST /api/v1/follow-ups`, `GET /api/v1/follow-ups`, `PATCH /api/v1/follow-ups/{reminder_id}/complete`.

## Migration
Run `cd backend && alembic upgrade head`. Migration `0011_email_intake` follows `0010_delivery_revenue`.

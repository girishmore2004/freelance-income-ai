# Release 2.0 — Unified Freelance Business Workspace

## Purpose

Release 2.0 adds an operating layer over the existing discovery, proposal, communication, project delivery, invoicing and analytics modules. It extends the existing application; it does not replace its FastAPI, SQLAlchemy, PostgreSQL, Redis/RQ, LangGraph or Next.js architecture.

## What's new

- `/workspace` is a unified workspace showing saved opportunity, proposal, approval, project, invoice and task signals.
- Business goals can be saved per account: monthly income target, weekly hours, monthly proposal target, monthly outreach target and currency.
- Workspace alerts flag overdue invoices/tasks, pending proposal/email approvals, due client follow-ups, project deadlines in the next seven days, stale open opportunities and weekly capacity overload.
- Explainable business-coach recommendations cite the specific record counts that triggered each suggestion. The v2.0 coach is intentionally deterministic; it does not invent metrics or imply an LLM has reasoned over records.
- Workspace goal changes are recorded in a tenant-scoped audit table.
- The existing dashboard links to the workspace. Existing feature routes remain available.

## API

- `GET /api/v1/workspace/overview`
- `GET /api/v1/business-goals`
- `PUT /api/v1/business-goals`
- `GET /api/v1/workspace/events?limit=50`

The goal update endpoint accepts only `monthly_income_target`, `weekly_hours_target`, `monthly_proposals_target`, `monthly_outreach_target`, and `currency`. All endpoints require the existing bearer-token authentication. Data queries are scoped to the authenticated user.

## Alert and metric definitions

- Overdue invoices: invoices owned by the user, in `unpaid` or `overdue` state, with a non-empty ISO date earlier than the current UTC date.
- Overdue tasks: tasks owned by the user, not in `done` or `completed`, with a non-empty ISO date earlier than the current UTC date.
- Due follow-ups: open reminders whose due timestamp has passed.
- Upcoming deadlines: active projects with an ISO due date from today through the next seven days.
- Stale opportunities: open opportunities with a recorded `last_seen_at` older than 14 days; records without a `last_seen_at` are not classified as stale.
- Capacity overload: logged time in the last seven days exceeds the saved weekly-hours target.
- Paid revenue this month: invoices marked `paid` and created since the first day of the current UTC month, grouped by currency. No FX conversion is attempted.
- Monthly proposal count: proposals created since the first day of the current UTC month.
- Missing records are not interpreted as zero activity outside the explicitly displayed counts. The coach does not claim that an action succeeded.

## Migration

Apply `0017_business_workspace` after the existing migration chain:

```bash
cd backend
alembic upgrade head
```

The migration creates `business_goals` and `business_workspace_events`. Downgrade with `alembic downgrade 0016_project_opportunity_attribution` only after backing up the database and confirming no v2.0 goal/audit data needs to be retained.

## Safety

The workspace is advisory. It does not send emails, submit marketplace applications, deliver client files, issue invoices to clients or transfer money. Existing explicit approval gates remain in force.

# Release 2.2 — Evidence-linked AI Action Planner

## Purpose

Release 2.2 adds a deterministic next-action planner that turns existing account records into a prioritized work queue. It is a read-only recommendation layer; it does not perform external actions.

## Included

- `GET /api/v1/agent/action-plan?limit=12` — returns prioritized recommendations from the authenticated user's invoices, tasks, follow-up reminders, opportunities and projects.
- `backend/app/services/action_planner.py` — pure planning logic with date parsing, status filtering, priority ordering and evidence references.
- `frontend/app/agent/page.tsx` — `/agent` action-plan view.
- Coach page navigation to the action planner.

## Rules

- Overdue invoices and project deadlines receive highest priority.
- Due-today/overdue tasks and follow-up reminders are surfaced.
- Opportunities older than 14 days are flagged only if their recorded status is not a closed/submitted state.
- Completed tasks and paid/void/cancelled invoices are ignored.
- Every action includes the source record type and ID, a reason, and a suggested next step.
- Every item is marked `requires_human_approval: true`.
- The endpoint reads only rows belonging to the authenticated user.
- The planner does not send email, submit proposals, change records, issue invoices, or move money.

## Limitations

This release is deterministic rules-based planning, not autonomous multi-agent execution. It does not infer missing due dates, estimate project completion, or claim that an opportunity is still open. The stale-opportunity threshold is a fixed 14 days. The planner is advisory and users should verify the underlying record before acting.

## API example

`GET /api/v1/agent/action-plan?limit=10`

The response contains `as_of_date`, `actions`, `total_actionable_records`, and a safety policy statement. Each action includes `priority`, `category`, `title`, `reason`, `evidence`, `suggested_action`, `due_date`, and `requires_human_approval`.

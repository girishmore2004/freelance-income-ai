# Upgrade v4.6.0 to v4.7.0

## Scope

This is an additive action-planning enhancement to the existing FastAPI + SQLAlchemy + Next.js application. It does not rebuild the project, add runtime dependencies, or change the database schema.

## What changed

The account-scoped AI Action Planner now considers:
- Existing overdue invoices, tasks, follow-ups, stale opportunities and project deadlines.
- Milestones due today or overdue.
- Deliverables awaiting review, due today or overdue.
- Approved invoice schedules that have not yet created an invoice, plus due schedules awaiting review.
- Pending proposal approvals.
- Client email drafts awaiting approval.
- Marketplace applications approved for manual submission but not yet recorded as submitted.

The UI now groups counts by business area and supports category filtering. All recommendations are evidence-linked and remain advisory. The app does not submit proposals, send email, issue invoices, hand over deliverables or move money from this action plan.

## Database and deployment

- No Alembic migration is required.
- No new production package is required.
- Deploy the API and frontend from the same v4.7.0 commit.
- Existing records are queried with the authenticated user's `user_id`; the action planner does not aggregate other accounts.

## Upgrade steps

1. Back up the production database.
2. Commit and push the v4.7.0 changes.
3. Wait for GitHub Actions to pass.
4. Deploy the API, then deploy the frontend.
5. Sign in and open `/agent`.
6. Verify pending approvals, due deliverables and invoice schedules appear only when corresponding records exist in your account.

## Rollback

If the frontend has an issue, roll back the frontend deployment to the previous commit. If the API has an issue, roll back the API to the previous commit. No schema change means no database downgrade is required.

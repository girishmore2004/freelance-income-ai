# Upgrade 5.18.0 → 5.19.0

1. Back up the deployed database and current source.
2. Deploy the v5.19.0 source ZIP.
3. Install dependencies using the existing backend and frontend lockfiles.
4. No database migration is required.
5. The Analytics page now requests `GET /api/v1/analytics/service-intelligence`.

The endpoint is read-only and scopes opportunities, proposals, applications, feedback, projects, invoices, payment events, costs and time entries to the authenticated user.

Category assignment uses `Opportunity.industry` when populated. Otherwise it uses a deterministic keyword taxonomy over the opportunity title, description and required skills. Review `classification_methods` and correct the opportunity's industry when classification is inaccurate.

Cash is derived from manually recorded receipt/refund events linked through invoice → project → originating opportunity. Contribution is shown only when linked direct costs or billable labor costs exist, and is explicitly partial. No automatic marketplace submissions or client communications are introduced.

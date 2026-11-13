# Upgrade 5.17.0 → 5.18.0

1. Replace the previous source tree with this release or apply the included changes.
2. No database migration is required.
3. Install backend dependencies using `pip install -r backend/requirements.txt`.
4. Run backend tests with `cd backend && pytest -q`.
5. Deploy the backend and frontend as usual. The Analytics page calls `GET /api/v1/analytics/growth-recommendations`.

The endpoint is read-only and scopes all source records to the authenticated user. Recommendations are deterministic and based on manually recorded cohorts; they do not submit applications or contact clients.

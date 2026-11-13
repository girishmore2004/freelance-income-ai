# Release 1.2 verification

## Focused unit tests
```bash
cd backend
pytest -q tests/test_pricing_intelligence.py tests/test_time_entry_schema.py tests/test_opportunity_ranking.py
```

## API integration tests to run against a configured PostgreSQL test database
1. Create two users with opportunities, proposals, feedback, projects, time entries and invoices.
2. Verify User A cannot retrieve User B's pricing recommendation or profitability.
3. Verify fewer than three comparable wins do not influence baseline price.
4. Verify three or more comparable wins apply a bounded median, and unrelated categories do not contribute.
5. Verify repeated feedback for one opportunity does not duplicate that opportunity in pricing segments.
6. Verify cancelled invoices are excluded from non-cancelled invoiced value and only paid invoices count as revenue.
7. Verify price advice never updates the Proposal record.
8. Verify no external request is triggered by any endpoint.

## Frontend
```bash
cd frontend
npm ci
npm run typecheck
npm run build
```
Test the AI pricing intelligence button in Opportunities, pricing segments in Finance, and project profitability in Delivery.

## Deployment
No migration is required for v1.2:
```bash
docker compose config
docker compose build
docker compose up -d
```

## Packaging checks
- Python AST, JSON and Compose YAML validation.
- Focused automated test suite.
- ZIP CRC/integrity and SHA-256 file manifest.
- Full API/database integration, frontend production build and Docker build must still be run in the user's configured environment if not reported as passed by the release build.

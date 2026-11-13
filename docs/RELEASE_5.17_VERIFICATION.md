# Release 5.17.0 verification

## Scope
Opportunity-created cohort intelligence and the Business Intelligence cohort table.

## Checks
- Unit tests: `backend/tests/test_source_cohorts_v517.py`
- Regression tests: existing source trend, source ROI, proposal outcome, proposal quality and retrieval tests.
- Python compilation: `python -m compileall -q backend/app`
- Release package: `python ops/package_release.py --root . --output ../freelance-income-ai-v5.17.0.zip`
- Archive verification: CRC test and every `FILE_MANIFEST.json` SHA-256 entry.

## Limitations
Frontend production build and live PostgreSQL/browser integration require installed dependencies and configured services. Passing focused unit tests does not certify marketplace integrations, production deployment or end-to-end behavior.

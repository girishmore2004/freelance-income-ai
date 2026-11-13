# Release 1.3 verification

## Static checks
- Python AST parse for backend modules.
- JSON parse for package/config files.
- Alembic revision chain checked statically.
- Docker Compose YAML parse.
- ZIP integrity and manifest hashes checked.

## Focused tests
Email classification categories and priority rules are covered by `backend/tests/test_email_intelligence.py`.

## Not represented as verified
A live PostgreSQL migration, complete API integration suite, Docker image build, frontend dependency install/typecheck/build, Gmail/Outlook OAuth, inbox sync, and outbound sending require the deployment environment and credentials and have not been claimed as tested here.

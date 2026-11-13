# Release 5.23.0 verification

- Calendar availability blocks are user-owned and only queried/deleted with the authenticated user's ID.
- Unavailable hours reduce estimated weekly capacity; they do not rewrite task schedules.
- Task/milestone due-date collisions are review prompts, not inferred dependency violations.
- No external calendar connector or autonomous rescheduling is enabled.
- Focused tests: `pytest -q tests/test_calendar_intelligence_v523.py`.
- Frontend production build and live database migration must be verified in the deployment environment.

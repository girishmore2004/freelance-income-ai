# Release 5.28.0 verification

## Scope

Adaptive effort estimation from similar completed, task-time-tracked work.

## Verification checklist

- [x] 71 focused regression tests passed across v5.10–v5.28 intelligence, matching, scheduling and delivery modules.
- [x] Pure service tests cover median/range, insufficient samples, unrelated work exclusion, and confidence.
- [x] Python syntax compilation for changed backend files.
- [x] ZIP CRC and source-manifest SHA-256 verification during packaging.
- [ ] Full backend integration against configured PostgreSQL/pgvector environment.
- [ ] Frontend production build and browser end-to-end verification.

## Safety and data integrity

- Read-only analytics endpoint; no estimate or schedule mutation.
- Query is scoped to the authenticated user's tasks and time entries.
- Missing history remains unknown rather than being replaced by a guessed estimate.

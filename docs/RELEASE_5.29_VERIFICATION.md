# Release 5.29.0 verification

## Automated checks
- Focused bottleneck/revision, adaptive-effort, delivery-performance, dependency, schedule-recommendation and schedule-governance tests.
- Python compile check.
- Frontend build/typecheck when frontend dependencies are available.
- Deterministic release ZIP CRC and SHA-256 manifest verification.

## Interpretation safeguards
- Bottleneck signal score is deterministic triage, not probability or causality.
- Revision counts describe saved deliverable versions, not necessarily avoidable rework.
- Closed projects and completed/cancelled tasks are excluded from open bottleneck candidates.
- No schedule, estimate, status or external communication is changed.

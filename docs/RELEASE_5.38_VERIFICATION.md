# v5.38.0 Release Verification

## Scope
- Approved-snapshot PDF export.
- Invoice/payment reconciliation included in handover snapshots.
- Deterministic project closeout readiness checklist.
- Delivery workspace PDF download and blocker display.

## Safety and correctness
- PDF export requires an approved snapshot and verifies its stored SHA-256.
- Acceptance is counted only for the latest revision version and content hash.
- Invoice payment values come from the manual payment ledger; legacy paid status is disclosed.
- Currency totals are never converted or merged.
- Closeout readiness is not legal completion, bank verification, or automatic project closure.
- No migration, no new runtime dependency, no external communication.

## Environment limitations
- Full test/build verification must be repeated in an environment with all backend extras and frontend dependencies installed.

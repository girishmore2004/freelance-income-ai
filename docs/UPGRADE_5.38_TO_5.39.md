# Upgrade v5.38.0 to v5.39.0

## Changes
- New immutable `DeliveryCloseoutSignoff` records.
- New immutable `ProjectClosureRecord` records.
- Closeout sign-off requires an approved, hash-valid and fresh handover snapshot, no closeout blockers, role, note, evidence reference and exact confirmation phrase `SIGN OFF CLOSEOUT`.
- Project closure is a separate action requiring the sign-off ID and exact phrase `CLOSE PROJECT`. Readiness and freshness are revalidated before status changes to `completed`.
- Added retention and redaction preview endpoints. Both are non-destructive; redaction preview returns a separate redacted copy and hash.

## Migration
Back up PostgreSQL, then run `cd backend && alembic upgrade head`. This applies migration `0041_closeout_signoff_and_closure`. Do not reset the database.

## Deploy
Push the updated source to GitHub and deploy existing Render/Vercel services with existing environment variables.

## Safety
No client message is sent, no snapshot is deleted or modified, and project closure is never automatic.

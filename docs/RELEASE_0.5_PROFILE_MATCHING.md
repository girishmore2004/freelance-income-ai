# Release 0.5 — Freelancer profile, transparent matching and price guidance

## Based on the project plan
This release implements the profile inputs and six-part match score from the provided plan:
- Skill fit: 35 points
- Budget fit: 20 points
- Client quality: 15 points
- Deadline feasibility: 10 points
- Competition level: 10 points
- Scope clarity: 10 points

The score breakdown includes matched/missing skills and notes explaining when data is missing.
Unknown client information receives a neutral score; the app does not invent client reviews,
payment history, competition, deadlines, or client trust signals.

## New profile fields
Hourly rate, minimum budget, weekly availability, timezone, preferred work types,
preferred industries, and dealbreakers.

## New opportunity metadata
Job type, industry, estimated effort, competition level, client rating, review count,
and payment verification. These are optional and must come from the listing or your
own verified research.

## Price guidance
`GET /api/v1/opportunities/{id}/recommendation` returns a non-binding suggested price.
It uses the profile hourly rate and estimated hours when both exist, otherwise it
uses available listing budget information. The response explicitly says user review
is required and is not a commitment.

## Migration
```bash
cd backend
alembic upgrade head
```

## Important
- The app still does not auto-submit proposals or message clients.
- Client quality is only as reliable as the supplied evidence.
- This is not a substitute for reading the listing and checking the platform's rules.
- Run the complete test and deployment checklist before production use.

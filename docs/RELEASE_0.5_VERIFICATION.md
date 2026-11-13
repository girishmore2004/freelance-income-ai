# Release 0.5 verification checklist

```bash
cd backend
python -m pip install -r requirements.txt
alembic upgrade head
pytest -q
python -m compileall -q app
cd ../frontend
npm ci
npm run typecheck
npm run build
cd ..
docker compose config
docker compose build
docker compose up -d
```

Manual workflow:
1. Register or log in.
2. Save a profile with skills, minimum budget, hourly rate, weekly hours, timezone,
   work types, preferred industries and dealbreakers.
3. Add an opportunity with its available budget, estimated hours, deadline and
   client metadata. Leave unknown fields blank rather than guessing.
4. Inspect the six score components and notes.
5. Request the non-binding price recommendation endpoint.
6. Generate and edit a proposal.
7. Request approval, then approve/reject.
8. Edit a proposal after approval and verify the old approval cannot authorize the edit.
9. Mark an approved proposal ready for manual submission; confirm no external message is sent.

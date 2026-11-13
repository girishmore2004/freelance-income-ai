"""Calendar-aware availability and deadline conflict diagnostics.

Calendar blocks are user-entered unavailable hours, not inferred events.
"""
from collections import defaultdict
from datetime import date, timedelta

CLOSED = {"done", "completed", "cancelled", "canceled", "archived", "closed"}

def _date(value):
    try: return date.fromisoformat(str(value)[:10]) if value else None
    except (TypeError, ValueError): return None

def build_calendar_intelligence(tasks, projects, milestones, blocks, weekly_capacity_hours, today=None, horizon_weeks=8):
    today = today or date.today()
    capacity = max(0.0, float(weekly_capacity_hours or 0))
    project_map = {p.id: p for p in projects}
    unavailable = defaultdict(float)
    block_rows = []
    for b in blocks:
        d = _date(getattr(b, "block_date", None))
        hours = max(0.0, float(getattr(b, "unavailable_hours", 0) or 0))
        if d and today <= d < today + timedelta(days=7*horizon_weeks):
            unavailable[d] += hours
            block_rows.append({"id": b.id, "date": d.isoformat(), "hours": hours,
                               "kind": b.kind, "note": b.note or ""})
    weeks = []
    for i in range(horizon_weeks):
        start = today + timedelta(days=(7-today.weekday()) % 7 + 7*i) if i else today
        end = start + timedelta(days=6)
        base_daily = capacity / 7 if capacity else 0
        blocked = sum(unavailable[d] for d in (start + timedelta(days=j) for j in range(7)))
        effective = max(0.0, capacity - blocked)
        weeks.append({"week_start": start.isoformat(), "week_end": end.isoformat(),
                      "weekly_capacity_hours": round(capacity,2), "unavailable_hours": round(blocked,2),
                      "effective_capacity_hours": round(effective,2), "planned_hours": 0.0,
                      "over_capacity_hours": 0.0, "status": "within_capacity"})
    for t in tasks:
        if str(t.status or "todo").lower() in CLOSED: continue
        p = project_map.get(t.project_id)
        if not p or str(p.status or "active").lower() in CLOSED: continue
        start, due = _date(t.planned_start_date), _date(t.due_date)
        effort = max(0.0, float(t.estimated_hours or 0))
        if not start or not effort: continue
        finish = due or start
        if finish < start: continue
        days = (finish-start).days+1
        per_day = effort/days
        for w in weeks:
            ws, we = date.fromisoformat(w["week_start"]), date.fromisoformat(w["week_end"])
            a, z = max(start,ws), min(finish,we)
            if a <= z: w["planned_hours"] += per_day*((z-a).days+1)
    for w in weeks:
        w["planned_hours"] = round(w["planned_hours"],2)
        w["over_capacity_hours"] = round(max(0,w["planned_hours"]-w["effective_capacity_hours"]),2)
        w["status"] = "over_capacity" if w["over_capacity_hours"] > 0 else "reduced_capacity" if w["unavailable_hours"] else "within_capacity"
    # Milestone/task date collisions are surfaced as review prompts, not assumed dependency violations.
    due_items = defaultdict(list)
    for t in tasks:
        if str(t.status or "todo").lower() in CLOSED: continue
        d = _date(t.due_date)
        if d: due_items[d].append({"type":"task", "id":t.id, "title":t.title, "project_id":t.project_id})
    for m in milestones:
        if str(m.status or "pending").lower() in CLOSED: continue
        d = _date(m.due_date)
        if d: due_items[d].append({"type":"milestone", "id":m.id, "title":m.title, "project_id":m.project_id})
    conflicts = [{"date":d.isoformat(),"items":items,"reason":"Multiple open tasks or milestones share this due date; review sequencing and dependencies."}
                 for d,items in sorted(due_items.items()) if len(items)>1 and today <= d < today+timedelta(days=7*horizon_weeks)]
    return {"as_of":today.isoformat(),"horizon_weeks":horizon_weeks,"weekly_capacity_hours":round(capacity,2),
            "availability_blocks":sorted(block_rows,key=lambda x:x["date"]),"weeks":weeks,
            "deadline_date_collisions":conflicts,
            "method":"Weekly target is reduced by user-entered unavailable hours on matching dates. Task effort is spread evenly across its planned date range, consistent with commitment planning.",
            "limitations":["Only manually entered leave, holidays and personal blocks are considered; no external calendar is connected.","Date collisions are review prompts, not proof of dependency conflicts.","No task is automatically rescheduled and no client deadline is changed.","Task effort distribution is an estimate and may not reflect actual daily work."]}

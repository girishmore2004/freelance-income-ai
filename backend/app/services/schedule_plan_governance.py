"""Stable input fingerprinting for human-approved schedule plan snapshots."""
import hashlib
import json


def fingerprint_schedule_inputs(tasks, projects, dependencies, availability_blocks, weekly_capacity_hours, milestones=()):
    payload = {
        "weekly_capacity_hours": float(weekly_capacity_hours or 0),
        "projects": sorted((str(p.id), str(p.status or ""), str(p.title or "")) for p in projects),
        "tasks": sorted((str(t.id), str(t.project_id), str(t.status or ""), str(t.priority or ""),
                         str(t.estimated_hours), str(t.planned_start_date or ""), str(t.due_date or ""),
                         str(getattr(t, "planned_finish_date", "") or "")) for t in tasks),
        "dependencies": sorted((str(d.predecessor_task_id), str(d.successor_task_id)) for d in dependencies),
        "availability": sorted((str(b.block_date), float(b.unavailable_hours or 0), str(b.kind or "")) for b in availability_blocks),
        "milestones": sorted((str(m.id), str(m.project_id), str(m.status or ""), str(m.due_date or "")) for m in milestones),
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    return hashlib.sha256(encoded).hexdigest()

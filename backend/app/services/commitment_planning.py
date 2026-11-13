"""Forward-looking workload plan from explicitly estimated project tasks.

Only tasks with an effort estimate and a planned start date are allocated to weeks.
Tasks missing either are reported as unscheduled/unknown, never treated as zero work.
"""
from collections import defaultdict
from datetime import date, timedelta

CLOSED = {"done", "completed", "cancelled", "canceled"}


def _day(value):
    try:
        return date.fromisoformat(str(value)[:10]) if value else None
    except (TypeError, ValueError):
        return None


def _num(value):
    try:
        return max(0.0, float(value)) if value is not None else None
    except (TypeError, ValueError):
        return None


def build_commitment_plan(tasks, projects, weekly_capacity_hours, today=None, horizon_weeks=8):
    today = today or date.today()
    capacity = max(0.0, float(weekly_capacity_hours or 0))
    project_map = {p.id: p for p in projects}
    weeks = []
    for i in range(horizon_weeks):
        start = today + timedelta(days=(7 - today.weekday()) % 7 + 7 * i)
        # If today is Monday, include this current week from today.
        if i == 0:
            start = today
        end = start + timedelta(days=6)
        weeks.append({"week_start": start.isoformat(), "week_end": end.isoformat(), "planned_hours": 0.0, "task_count": 0, "tasks": []})
    unscheduled, unknown_effort, overdue = [], [], []
    included = 0
    for task in tasks:
        if str(getattr(task, "status", "todo") or "todo").lower() in CLOSED:
            continue
        project = project_map.get(getattr(task, "project_id", None))
        if not project or str(getattr(project, "status", "active") or "active").lower() in {"completed", "cancelled", "canceled", "archived", "closed"}:
            continue
        title = getattr(task, "title", "Untitled task")
        effort = _num(getattr(task, "estimated_hours", None))
        start = _day(getattr(task, "planned_start_date", None))
        due = _day(getattr(task, "due_date", None))
        item = {"task_id": task.id, "project_id": task.project_id, "project": project.title, "title": title,
                "estimated_hours": effort, "planned_start_date": start.isoformat() if start else None,
                "due_date": due.isoformat() if due else None, "status": task.status}
        if due and due < today:
            overdue.append(item)
        if effort is None or effort <= 0:
            unknown_effort.append(item)
            continue
        if not start:
            unscheduled.append(item)
            continue
        if due and due < start:
            item["schedule_issue"] = "due_date_before_start_date"
            unscheduled.append(item)
            continue
        end = due or start
        span_days = max(1, (end - start).days + 1)
        daily_hours = effort / span_days
        allocated = False
        for week in weeks:
            ws, we = date.fromisoformat(week["week_start"]), date.fromisoformat(week["week_end"])
            overlap_start, overlap_end = max(start, ws), min(end, we)
            if overlap_start <= overlap_end:
                hours = daily_hours * ((overlap_end - overlap_start).days + 1)
                week["planned_hours"] += hours
                week["task_count"] += 1
                week["tasks"].append({"task_id": task.id, "title": title, "project": project.title, "allocated_hours": round(hours, 2), "due_date": due.isoformat() if due else None})
                allocated = True
        if allocated:
            included += 1
        else:
            unscheduled.append(item)
    for week in weeks:
        planned = round(week["planned_hours"], 2)
        week["planned_hours"] = planned
        week["remaining_hours"] = round(max(0.0, capacity - planned), 2)
        week["over_capacity_hours"] = round(max(0.0, planned - capacity), 2)
        week["status"] = "over_capacity" if planned > capacity else "at_capacity" if capacity and planned >= capacity * 0.85 else "within_capacity"
    coverage_total = included + len(unscheduled) + len(unknown_effort)
    coverage = round(100 * included / coverage_total, 1) if coverage_total else 100.0
    return {"as_of": today.isoformat(), "horizon_weeks": horizon_weeks, "weekly_capacity_hours": round(capacity, 2),
            "scheduled_task_count": included, "unscheduled_task_count": len(unscheduled), "unknown_effort_task_count": len(unknown_effort),
            "schedule_coverage_percent": coverage, "weeks": weeks, "unscheduled_tasks": unscheduled,
            "unknown_effort_tasks": unknown_effort, "overdue_tasks": overdue,
            "method": "Open tasks with explicit effort and planned start dates are allocated evenly across their planned date range. This is an estimate, not calendar time blocking.",
            "limitations": ["Tasks without effort estimates or planned start dates are excluded from weekly allocations and shown separately.",
                            "Effort is distributed evenly across the task date range; actual work may be uneven.",
                            "Weekly capacity is the profile target and does not account for personal leave, meetings or external obligations.",
                            "Overdue tasks are highlighted separately; their remaining effort is not automatically rescheduled."]}

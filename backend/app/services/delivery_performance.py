"""Actual-versus-planned delivery intelligence from recorded task/time data.

Only explicit task estimates, time entries and completion timestamps are used.
Missing time logs or estimates remain unknown; this module never fabricates effort.
"""
from collections import defaultdict
from datetime import date
from statistics import median

CLOSED = {"done", "completed", "cancelled", "canceled", "archived", "closed"}


def _day(value):
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def build_delivery_performance(tasks, projects, time_entries, today=None):
    today = today or date.today()
    project_map = {p.id: p for p in projects}
    hours_by_task = defaultdict(float)
    entries_by_task = defaultdict(int)
    for entry in time_entries:
        if entry.task_id:
            hours_by_task[entry.task_id] += max(0, int(entry.duration_minutes or 0)) / 60.0
            entries_by_task[entry.task_id] += 1

    rows_by_project = defaultdict(list)
    task_rows = []
    completed_comparisons = []
    for task in tasks:
        project = project_map.get(task.project_id)
        if not project or str(project.status or "active").lower() in CLOSED:
            continue
        actual = round(hours_by_task.get(task.id, 0.0), 2)
        estimate = float(task.estimated_hours) if task.estimated_hours is not None else None
        variance = round(actual - estimate, 2) if estimate is not None and entries_by_task.get(task.id) else None
        variance_pct = round((variance / estimate) * 100, 1) if variance is not None and estimate and estimate > 0 else None
        status = str(task.status or "todo").lower()
        completed_at = getattr(task, "completed_at", None)
        completed_day = completed_at.date() if hasattr(completed_at, "date") else _day(completed_at)
        planned_finish = _day(getattr(task, "planned_finish_date", ""))
        schedule_variance_days = (completed_day - planned_finish).days if completed_day and planned_finish and status in CLOSED else None
        if status in CLOSED and status not in {"cancelled", "canceled", "archived"} and estimate and estimate > 0 and entries_by_task.get(task.id):
            completed_comparisons.append({"task_id": task.id, "absolute_percentage_error": abs(variance_pct or 0.0),
                                          "estimate_hours": estimate, "actual_hours": actual})
        row = {
            "task_id": task.id, "project_id": task.project_id, "project": project.title,
            "title": task.title, "status": status, "estimated_hours": estimate,
            "actual_logged_hours": actual if entries_by_task.get(task.id) else None,
            "time_entry_count": entries_by_task.get(task.id, 0),
            "effort_variance_hours": variance,
            "effort_variance_percent": variance_pct,
            "remaining_estimated_hours": (round(max(0.0, estimate - actual), 2) if entries_by_task.get(task.id) else estimate if status == "todo" else None) if estimate is not None and status not in CLOSED else None,
            "planned_finish_date": planned_finish.isoformat() if planned_finish else None,
            "completed_at": completed_at.isoformat() if hasattr(completed_at, "isoformat") else None,
            "schedule_variance_days": schedule_variance_days,
            "actual_effort_known": bool(entries_by_task.get(task.id)),
            "time_tracking_status": "recorded" if entries_by_task.get(task.id) else "not_started" if status == "todo" else "missing",
            "estimate_known": estimate is not None,
        }
        task_rows.append(row)
        rows_by_project[task.project_id].append(row)

    project_rows = []
    for project_id, rows in sorted(rows_by_project.items(), key=lambda item: (project_map[item[0]].title or "").lower()):
        completed = [r for r in rows if r["status"] in {"done", "completed"}]
        comparable = [r for r in completed if r["estimated_hours"] is not None and r["estimated_hours"] > 0 and r["actual_logged_hours"] is not None]
        schedule_known = [r for r in completed if r["schedule_variance_days"] is not None]
        project_rows.append({
            "project_id": project_id, "project": project_map[project_id].title,
            "task_count": len(rows), "completed_tasks": len(completed),
            "tasks_with_actual_time": sum(1 for r in rows if r["actual_effort_known"]),
            "tasks_missing_time_logs": sum(1 for r in rows if r["time_tracking_status"] == "missing"),
            "tasks_missing_estimates": sum(1 for r in rows if not r["estimate_known"]),
            "completed_tasks_comparable": len(comparable),
            "estimated_hours_comparable": round(sum(r["estimated_hours"] for r in comparable), 2),
            "actual_hours_comparable": round(sum(r["actual_logged_hours"] for r in comparable), 2),
            "median_effort_variance_percent": round(median([r["effort_variance_percent"] for r in comparable if r["effort_variance_percent"] is not None]), 1) if any(r["effort_variance_percent"] is not None for r in comparable) else None,
            "median_schedule_variance_days": round(median([r["schedule_variance_days"] for r in schedule_known]), 1) if schedule_known else None,
            "schedule_dates_known": len(schedule_known),
            "data_quality": "usable_sample" if len(comparable) >= 3 else "small_sample" if comparable else "insufficient_actuals",
        })

    comparable_all = [r for r in task_rows if r["status"] in {"done", "completed"} and r["estimated_hours"] is not None and r["estimated_hours"] > 0 and r["actual_logged_hours"] is not None]
    absolute_errors = [abs(r["effort_variance_percent"]) for r in comparable_all if r["effort_variance_percent"] is not None]
    # Positive variance means actual > estimate: the task was under-estimated.
    under = sum(1 for r in comparable_all if r["effort_variance_hours"] > 0)
    over = sum(1 for r in comparable_all if r["effort_variance_hours"] < 0)
    return {
        "as_of": today.isoformat(),
        "summary": {
            "active_projects": len(project_rows), "tasks": len(task_rows),
            "completed_tasks": sum(1 for r in task_rows if r["status"] in {"done", "completed"}),
            "completed_tasks_with_comparable_actuals": len(comparable_all),
            "tasks_missing_time_logs": sum(1 for r in task_rows if r["time_tracking_status"] == "missing"),
            "tasks_missing_estimates": sum(1 for r in task_rows if not r["estimate_known"]),
            "median_absolute_effort_error_percent": round(median(absolute_errors), 1) if absolute_errors else None,
            "over_estimated_tasks": over, "under_estimated_tasks": under,
        },
        "projects": project_rows,
        "tasks": sorted(task_rows, key=lambda r: (r["project"].lower(), r["title"].lower())),
        "method": "Actual effort is summed from task-linked time entries. Effort variance is actual logged hours minus the original task estimate. Schedule variance compares the recorded completion timestamp with planned finish date.",
        "limitations": [
            "Only task-linked time entries are attributed; unlinked project time is excluded.",
            "Existing completed tasks without a completion timestamp have unknown schedule variance.",
            "No time entry does not mean zero effort; actual effort is reported as unknown.",
            "Estimate accuracy is descriptive and requires completed tasks with positive estimates and recorded time.",
            "Calendar-day schedule variance is not a business-day or client-acceptance measure.",
        ],
    }

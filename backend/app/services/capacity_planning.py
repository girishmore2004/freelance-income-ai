"""Capacity-aware pursuit planning from explicit profile, project and time records.

Historical time entries are used as an observed workload baseline, not proof of
future commitments. Untracked active projects reduce confidence rather than being
silently treated as zero workload.
"""
from collections import defaultdict
from datetime import date, datetime, timedelta

ACTIVE_STATUSES = {"active", "in_progress", "in progress", "on_hold", "on hold"}
CLOSED_STATUSES = {"completed", "cancelled", "canceled", "archived", "closed"}


def _date(value):
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _hours(value):
    try:
        return max(0.0, float(value or 0))
    except (TypeError, ValueError):
        return 0.0


def build_capacity_plan(opportunities, profile=None, projects=(), tasks=(), time_entries=(), today=None, lookback_days=28):
    today = today or date.today()
    weekly_target = max(0.0, _hours(getattr(profile, "weekly_hours", 0)))
    cutoff = today - timedelta(days=lookback_days - 1)
    active_projects = [p for p in projects if str(getattr(p, "status", "active") or "active").lower() in ACTIVE_STATUSES]
    active_ids = {p.id for p in active_projects}
    project_hours = defaultdict(float)
    project_has_logs = set()
    weekly_logged = 0.0
    for entry in time_entries:
        work_day = _date(getattr(entry, "work_date", None))
        project_id = getattr(entry, "project_id", None)
        if not work_day or work_day < cutoff or work_day > today or project_id not in active_ids:
            continue
        h = _hours(getattr(entry, "duration_minutes", 0)) / 60
        project_hours[project_id] += h
        project_has_logs.add(project_id)
        weekly_logged += h
    weeks = max(1.0, lookback_days / 7)
    observed_weekly_load = weekly_logged / weeks
    untracked_projects = sorted(str(getattr(p, "title", "Active project")) for p in active_projects if p.id not in project_has_logs)
    # This is a planning estimate, not a reservation ledger. If any active project
    # lacks time logs, mark availability as uncertain and do not claim a precise free capacity.
    free_weekly_estimate = max(0.0, weekly_target - observed_weekly_load)
    coverage = round(100 * (len(active_ids & project_has_logs) / len(active_ids)), 1) if active_ids else 100.0
    task_counts = defaultdict(int)
    for task in tasks:
        if getattr(task, "project_id", None) not in active_ids:
            continue
        status = str(getattr(task, "status", "todo") or "todo").lower()
        if status not in {"done", "completed", "cancelled", "canceled"}:
            task_counts[getattr(task, "project_id", "")] += 1
    rows = []
    for opp in opportunities:
        estimate = getattr(opp, "estimated_hours", None)
        deadline = _date(getattr(opp, "deadline", None))
        days_left = (deadline - today).days if deadline else None
        reasons = []
        if estimate is None or _hours(estimate) <= 0:
            status, confidence, available = "unknown_effort", "low", None
            reasons.append("Opportunity effort estimate is missing; feasibility cannot be calculated")
        elif days_left is None:
            status, confidence, available = "unknown_deadline", "low", None
            reasons.append("A valid deadline is missing; the available work window is unknown")
        elif days_left < 0:
            status, confidence, available = "deadline_passed", "high", 0.0
            reasons.append("The recorded deadline has already passed")
        else:
            available = round(free_weekly_estimate * days_left / 7, 2)
            if _hours(estimate) <= available:
                status = "feasible_on_observed_baseline"
            elif available > 0 and _hours(estimate) <= available * 1.25:
                status = "tight_capacity"
            else:
                status = "over_capacity_on_observed_baseline"
            confidence = "medium" if coverage == 100 and active_projects else "low" if untracked_projects else "medium"
            if not active_projects:
                confidence = "medium"
            reasons.append(f"Estimated effort: {_hours(estimate):g}h; available estimate by deadline: {available:g}h")
        if untracked_projects:
            reasons.append(f"{len(untracked_projects)} active project(s) have no time logs in the lookback window")
        if active_projects:
            reasons.append(f"Observed active-project workload: {observed_weekly_load:.1f}h/week from recorded time entries")
        rows.append({
            "opportunity_id": getattr(opp, "id", None), "title": getattr(opp, "title", ""),
            "estimated_hours": _hours(estimate) if estimate is not None else None,
            "deadline": deadline.isoformat() if deadline else None, "days_until_deadline": days_left,
            "capacity_available_before_deadline_hours": available,
            "capacity_status": status, "confidence": confidence,
            "reasons": reasons,
        })
    priority = {"feasible_on_observed_baseline": 0, "tight_capacity": 1, "unknown_effort": 2,
                "unknown_deadline": 3, "over_capacity_on_observed_baseline": 4, "deadline_passed": 5}
    rows.sort(key=lambda x: (priority.get(x["capacity_status"], 9), x["days_until_deadline"] if x["days_until_deadline"] is not None else 99999, x["title"].lower()))
    return {
        "as_of": today.isoformat(), "lookback_days": lookback_days,
        "weekly_capacity_target_hours": round(weekly_target, 2),
        "observed_active_project_hours_per_week": round(observed_weekly_load, 2),
        "estimated_remaining_weekly_capacity_hours": round(free_weekly_estimate, 2),
        "active_projects": len(active_projects), "active_projects_with_time_logs": len(active_ids & project_has_logs),
        "active_project_task_counts": dict(task_counts), "workload_data_coverage_percent": coverage,
        "untracked_active_projects": untracked_projects,
        "opportunities": rows,
        "method": "Deadline capacity is estimated from profile weekly-hours target minus recorded active-project hours/week over the lookback window. It is a planning signal, not a booked calendar.",
        "limitations": [
            "Time entries measure recorded historical work, not confirmed future commitments or all work performed.",
            "Projects without time logs are listed as untracked; their workload is unknown, not zero.",
            "Project tasks have no reliable effort estimate in the current data model and are not converted into hours.",
            "Opportunity effort and deadline are used only when explicitly recorded; missing values produce unknown feasibility.",
        ],
    }

"""Read-only, capacity-aware task schedule recommendations.

Produces proposed dates only. It never mutates task records or sends client updates.
"""
from collections import defaultdict, deque
from datetime import date, timedelta

CLOSED = {"done", "completed", "cancelled", "canceled", "archived", "closed"}
PRIORITY = {"urgent": 0, "high": 1, "medium": 2, "low": 3}


def _date(value):
    try:
        return date.fromisoformat(str(value)[:10]) if value else None
    except (TypeError, ValueError):
        return None


def build_schedule_recommendations(tasks, projects, dependencies, availability_blocks,
                                   weekly_capacity_hours, milestones=(), today=None, horizon_days=56):
    today = today or date.today()
    horizon_end = today + timedelta(days=horizon_days)
    project_map = {p.id: p for p in projects}
    task_map = {t.id: t for t in tasks}
    active_projects = {p.id for p in projects if str(p.status or "active").lower() not in CLOSED}
    active_tasks = [t for t in tasks if t.project_id in active_projects and str(t.status or "todo").lower() not in CLOSED]
    active_ids = {t.id for t in active_tasks}
    edges = [e for e in dependencies if e.predecessor_task_id in active_ids and e.successor_task_id in active_ids]
    outgoing, incoming, indegree = defaultdict(list), defaultdict(list), {tid: 0 for tid in active_ids}
    for edge in edges:
        outgoing[edge.predecessor_task_id].append(edge.successor_task_id)
        incoming[edge.successor_task_id].append(edge.predecessor_task_id)
        indegree[edge.successor_task_id] += 1
    queue = deque(sorted(tid for tid, n in indegree.items() if n == 0))
    topo = []
    while queue:
        tid = queue.popleft(); topo.append(tid)
        for nxt in sorted(outgoing[tid]):
            indegree[nxt] -= 1
            if indegree[nxt] == 0: queue.append(nxt)
    cycle_ids = sorted(active_ids - set(topo))
    cycle_projects = {task_map[tid].project_id for tid in cycle_ids}

    unavailable = defaultdict(float)
    for block in availability_blocks:
        d = _date(getattr(block, "block_date", None))
        if d and today <= d <= horizon_end:
            unavailable[d] += max(0.0, float(getattr(block, "unavailable_hours", 0) or 0))

    weekly = max(0.0, float(weekly_capacity_hours or 0))
    # Capacity is distributed across weekdays; weekends are intentionally not assumed working days.
    base_daily = weekly / 5.0
    remaining = {}
    for offset in range(horizon_days + 1):
        day = today + timedelta(days=offset)
        if day.weekday() < 5:
            remaining[day] = max(0.0, base_daily - unavailable[day])

    # Deterministic ordering: higher priority, earlier contractual due date, then project/task name.
    def order_key(tid):
        task = task_map[tid]
        due = _date(task.due_date) or date.max
        project = project_map.get(task.project_id)
        return (PRIORITY.get(str(task.priority or "medium").lower(), 2), due,
                (getattr(project, "title", "") or "").lower(), (task.title or "").lower(), tid)
    topo_rank = {tid: i for i, tid in enumerate(topo)}
    ordered = sorted(topo, key=lambda tid: (topo_rank[tid],) + order_key(tid))

    scheduled = {}
    rows = []
    for tid in ordered:
        task = task_map[tid]
        project = project_map.get(task.project_id)
        if task.project_id in cycle_projects:
            rows.append({"task_id": tid, "project_id": task.project_id, "project": project.title if project else "",
                         "title": task.title, "status": "blocked_dependency_cycle", "recommended_start": None,
                         "recommended_finish": None, "estimated_hours": task.estimated_hours,
                         "reason": "This project's dependency graph contains a cycle; resolve it before scheduling."})
            continue
        try: effort = float(task.estimated_hours) if task.estimated_hours is not None else None
        except (TypeError, ValueError): effort = None
        if effort is None or effort <= 0:
            rows.append({"task_id": tid, "project_id": task.project_id, "project": project.title if project else "",
                         "title": task.title, "status": "missing_effort", "recommended_start": None,
                         "recommended_finish": None, "estimated_hours": task.estimated_hours,
                         "reason": "Add a positive effort estimate before a date recommendation can be calculated."})
            continue
        earliest = max(today, _date(task.planned_start_date) or today)
        unresolved_predecessors = [p for p in incoming[tid] if p not in scheduled or not scheduled[p].get("finish")]
        if unresolved_predecessors:
            rows.append({"task_id": tid, "project_id": task.project_id, "project": project.title if project else "",
                         "title": task.title, "status": "blocked_predecessor_unscheduled", "recommended_start": None,
                         "recommended_finish": None, "estimated_hours": task.estimated_hours,
                         "reason": "At least one predecessor has unknown effort or cannot be scheduled; resolve it before assigning successor dates."})
            scheduled[tid] = {"finish": None}
            continue
        pred_finishes = [scheduled[p]["finish"] for p in incoming[tid] if p in scheduled]
        if pred_finishes:
            earliest = max(earliest, max(pred_finishes) + timedelta(days=1))
        # Allocate across available weekdays; task may span multiple days.
        left, first, finish = effort, None, None
        cursor = earliest
        while cursor <= horizon_end and left > 1e-8:
            if cursor.weekday() < 5 and remaining.get(cursor, 0) > 1e-8:
                take = min(left, remaining[cursor])
                remaining[cursor] -= take
                left -= take
                if first is None: first = cursor
                finish = cursor
            cursor += timedelta(days=1)
        if first is None or left > 1e-8:
            status = "outside_horizon"
            reason = "Insufficient recorded weekday capacity inside the planning horizon; extend the horizon or review capacity."
            scheduled[tid] = {"finish": None}
        else:
            due = _date(task.due_date)
            late = bool(due and finish > due)
            status = "projected_late" if late else "schedule_candidate"
            reason = (f"Proposed dates use {effort:g} estimated hours, weekday capacity and recorded unavailable time."
                      + (" The projected finish is after the recorded due date." if late else ""))
            scheduled[tid] = {"finish": finish}
        rows.append({"task_id": tid, "project_id": task.project_id, "project": project.title if project else "",
                     "title": task.title, "status": status,
                     "recommended_start": first.isoformat() if first else None,
                     "recommended_finish": finish.isoformat() if finish else None,
                     "due_date": _date(task.due_date).isoformat() if _date(task.due_date) else None,
                     "estimated_hours": effort, "remaining_unscheduled_hours": round(left, 2), "reason": reason})

    # Compare projected project completion with explicit project milestone dates.
    project_finishes = defaultdict(list)
    for row in rows:
        if row.get("recommended_finish"):
            project_finishes[row["project_id"]].append(date.fromisoformat(row["recommended_finish"]))
    milestone_impacts = []
    for milestone in milestones:
        if milestone.project_id not in active_projects or str(milestone.status or "pending").lower() in CLOSED:
            continue
        due = _date(milestone.due_date)
        finishes = project_finishes.get(milestone.project_id, [])
        projected = max(finishes) if finishes else None
        if due and projected and projected > due:
            milestone_impacts.append({"milestone_id": milestone.id, "project_id": milestone.project_id,
                                      "milestone": milestone.title, "due_date": due.isoformat(),
                                      "projected_project_finish": projected.isoformat(),
                                      "status": "projected_at_risk"})

    for tid in cycle_ids:
        task = task_map[tid]; project = project_map.get(task.project_id)
        rows.append({"task_id": tid, "project_id": task.project_id, "project": project.title if project else "",
                     "title": task.title, "status": "blocked_dependency_cycle", "recommended_start": None,
                     "recommended_finish": None, "estimated_hours": task.estimated_hours,
                     "reason": "This task belongs to a circular dependency chain."})

    counts = defaultdict(int)
    for row in rows: counts[row["status"]] += 1
    return {"as_of": today.isoformat(), "horizon_end": horizon_end.isoformat(),
            "weekly_capacity_hours": round(weekly, 2), "weekday_capacity_hours": round(base_daily, 2),
            "recommendations": rows, "summary": dict(counts), "milestone_impacts": milestone_impacts,
            "method": "Read-only deterministic scheduler. It allocates estimated task effort across weekdays using profile weekly capacity, subtracts user-entered unavailable hours, and respects finish-to-start dependencies.",
            "limitations": ["These are proposed dates, not saved task dates; review and update tasks manually.",
                            "Tasks are prioritized by urgency, due date, project and title; this is not an optimization solver.",
                            "Capacity is assumed evenly distributed over Monday-Friday; working-hour preferences are not modeled.",
                            "Milestone impact is project-level because milestones are not linked to individual tasks in the current schema.",
                            "No external calendar, client message, deadline change or task mutation is performed.",
                            "Missing estimates and dependency cycles are not silently scheduled."]}

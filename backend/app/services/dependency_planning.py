"""Explainable task dependency and critical-path diagnostics.

Dependencies are explicit user-entered finish-to-start links. This module never
moves dates or changes task status; missing effort is kept unknown.
"""
from collections import defaultdict, deque
from datetime import date, timedelta

CLOSED = {"done", "completed", "cancelled", "canceled", "archived", "closed"}

def _date(value):
    try:
        return date.fromisoformat(str(value)[:10]) if value else None
    except (TypeError, ValueError):
        return None

def build_dependency_plan(tasks, projects, dependencies, today=None):
    today = today or date.today()
    task_map = {t.id: t for t in tasks}
    project_map = {p.id: p for p in projects}
    by_project = defaultdict(list)
    for task in tasks:
        project = project_map.get(task.project_id)
        if project and str(project.status or "active").lower() not in CLOSED:
            by_project[task.project_id].append(task)

    output, total_edges = [], 0
    for project_id, project_tasks in sorted(by_project.items(), key=lambda item: (project_map[item[0]].title or "").lower()):
        nodes = {t.id: t for t in project_tasks}
        outgoing, indegree, incoming = defaultdict(list), {tid: 0 for tid in nodes}, defaultdict(list)
        edges = []
        for dep in dependencies:
            if dep.project_id != project_id or dep.predecessor_task_id not in nodes or dep.successor_task_id not in nodes:
                continue
            outgoing[dep.predecessor_task_id].append(dep.successor_task_id)
            incoming[dep.successor_task_id].append(dep.predecessor_task_id)
            indegree[dep.successor_task_id] += 1
            edges.append({"id": dep.id, "predecessor_task_id": dep.predecessor_task_id,
                          "successor_task_id": dep.successor_task_id})
        total_edges += len(edges)
        queue = deque(sorted([tid for tid, degree in indegree.items() if degree == 0]))
        order = []
        while queue:
            tid = queue.popleft(); order.append(tid)
            for nxt in sorted(outgoing[tid]):
                indegree[nxt] -= 1
                if indegree[nxt] == 0:
                    queue.append(nxt)
        cycle = len(order) != len(nodes)
        if cycle:
            cycle_nodes = sorted(tid for tid, degree in indegree.items() if degree > 0)
            output.append({"project_id": project_id, "project": project_map[project_id].title,
                           "dependency_count": len(edges), "edges": edges, "has_cycle": True,
                           "cycle_task_ids": cycle_nodes, "critical_path_hours": None,
                           "critical_path_task_ids": [], "tasks": [],
                           "risk": "invalid_dependency_cycle",
                           "note": "Resolve the circular dependency before using this sequence."})
            continue
        distance, parent = {}, {}
        for tid in order:
            duration = nodes[tid].estimated_hours
            duration = max(0.0, float(duration)) if duration is not None else 0.0
            best_pred = max(incoming[tid], key=lambda p: distance.get(p, 0.0), default=None)
            distance[tid] = (distance.get(best_pred, 0.0) if best_pred else 0.0) + duration
            parent[tid] = best_pred
        endpoint = max(order, key=lambda tid: distance.get(tid, 0.0), default=None)
        path, cursor = [], endpoint
        while cursor:
            path.append(cursor); cursor = parent.get(cursor)
        path.reverse()
        unknown = [t.id for t in project_tasks if t.id in nodes and t.estimated_hours is None and str(t.status or "todo").lower() not in CLOSED]
        task_rows = []
        for t in project_tasks:
            if str(t.status or "todo").lower() in CLOSED:
                continue
            predecessors = incoming[t.id]
            start = _date(t.planned_start_date)
            due = _date(t.due_date)
            task_rows.append({"task_id": t.id, "title": t.title, "status": t.status,
                              "estimated_hours": t.estimated_hours,
                              "predecessor_task_ids": predecessors,
                              "successor_task_ids": outgoing[t.id],
                              "planned_start_date": start.isoformat() if start else None,
                              "due_date": due.isoformat() if due else None,
                              "is_on_critical_path": t.id in path})
        # A predecessor due after successor start is a schedule warning, not proof of missed delivery.
        conflicts = []
        for dep in edges:
            pred, succ = nodes[dep["predecessor_task_id"]], nodes[dep["successor_task_id"]]
            pred_due, succ_start = _date(pred.due_date), _date(succ.planned_start_date)
            if pred_due and succ_start and succ_start < pred_due:
                conflicts.append({"predecessor": pred.title, "successor": succ.title,
                                  "predecessor_due": pred_due.isoformat(), "successor_start": succ_start.isoformat()})
        output.append({"project_id": project_id, "project": project_map[project_id].title,
                       "dependency_count": len(edges), "edges": edges, "has_cycle": False, "cycle_task_ids": [],
                       "critical_path_hours": round(distance.get(endpoint, 0.0), 2) if endpoint else 0.0,
                       "critical_path_task_ids": path, "unknown_effort_task_ids": unknown,
                       "schedule_conflicts": conflicts, "tasks": task_rows,
                       "risk": "unknown_effort" if unknown else "review_schedule" if conflicts else "sequenced",
                       "note": "Critical path sums estimated task hours along the longest dependency chain; it is not a calendar-duration or delivery guarantee."})
    return {"as_of": today.isoformat(), "projects": output, "dependency_count": total_edges,
            "method": "Explicit finish-to-start dependencies are topologically sorted per active project. The longest path sums known estimated hours; missing estimates contribute no assumed duration and are separately flagged.",
            "limitations": ["Only dependencies manually recorded by the user are considered.",
                            "No automatic task rescheduling, deadline changes, or client notifications occur.",
                            "Parallel tasks, holidays, working-day calendars, and resource contention are not modeled in critical-path duration.",
                            "A dependency schedule conflict is a review prompt, not proof that delivery is impossible."]}

"""Evidence-based delivery bottleneck and revision-activity intelligence.

Signals are descriptive. Dependency centrality, overdue dates and effort variance
can identify work worth reviewing, but do not prove that a task caused a delay.
Deliverable revision counts measure revision activity, not necessarily avoidable rework.
"""
from collections import defaultdict
from datetime import date

CLOSED = {"done", "completed", "cancelled", "canceled", "archived", "closed"}


def _day(value):
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def build_delivery_bottlenecks(tasks, projects, dependencies, deliverables, revisions, today=None):
    today = today or date.today()
    project_map = {p.id: p for p in projects}
    task_map = {t.id: t for t in tasks}
    active_projects = {p.id: p for p in projects if str(p.status or "active").lower() not in CLOSED}
    active_tasks = [t for t in tasks if t.project_id in active_projects and str(t.status or "todo").lower() not in CLOSED]

    incoming, outgoing = defaultdict(set), defaultdict(set)
    for edge in dependencies:
        if edge.project_id not in active_projects:
            continue
        predecessor = task_map.get(edge.predecessor_task_id)
        successor = task_map.get(edge.successor_task_id)
        if not predecessor or not successor:
            continue
        if predecessor.project_id != edge.project_id or successor.project_id != edge.project_id:
            continue
        incoming[edge.successor_task_id].add(edge.predecessor_task_id)
        outgoing[edge.predecessor_task_id].add(edge.successor_task_id)

    # A topological pass computes the longest chain for valid dependency graphs.
    critical_by_project = defaultdict(set)
    cycle_projects = set()
    for project_id in active_projects:
        nodes = {t.id: t for t in active_tasks if t.project_id == project_id}
        indegree = {tid: len([p for p in incoming[tid] if p in nodes]) for tid in nodes}
        queue = sorted(tid for tid, degree in indegree.items() if degree == 0)
        order = []
        while queue:
            tid = queue.pop(0)
            order.append(tid)
            for nxt in sorted(outgoing[tid]):
                if nxt in indegree:
                    indegree[nxt] -= 1
                    if indegree[nxt] == 0:
                        queue.append(nxt)
                        queue.sort()
        if len(order) != len(nodes):
            cycle_projects.add(project_id)
            continue
        distance, parent = {}, {}
        for tid in order:
            preds = [p for p in incoming[tid] if p in nodes]
            best = max(preds, key=lambda p: distance.get(p, 0.0), default=None)
            hours = nodes[tid].estimated_hours
            distance[tid] = (distance.get(best, 0.0) if best else 0.0) + (max(0.0, float(hours)) if hours is not None else 0.0)
            parent[tid] = best
        sinks = [tid for tid in order if not [n for n in outgoing[tid] if n in nodes]]
        end = max(sinks or order, key=lambda tid: distance.get(tid, 0.0), default=None)
        cursor = end
        while cursor:
            critical_by_project[project_id].add(cursor)
            cursor = parent.get(cursor)

    bottleneck_rows = []
    by_project_tasks = defaultdict(list)
    for task in active_tasks:
        due = _day(getattr(task, "due_date", None))
        overdue = bool(due and due < today)
        critical = task.id in critical_by_project[task.project_id]
        downstream = len(outgoing[task.id])
        upstream = len(incoming[task.id])
        # Transparent deterministic signal score; not a probability.
        signals = []
        score = 0
        if critical:
            score += 3; signals.append("critical_dependency_path")
        if downstream >= 2:
            score += 2; signals.append("multiple_downstream_tasks")
        elif downstream == 1:
            score += 1; signals.append("downstream_dependency")
        if overdue:
            score += 3; signals.append("past_due_date")
        estimate = getattr(task, "estimated_hours", None)
        if estimate is None:
            signals.append("effort_estimate_missing")
        row = {
            "task_id": task.id, "project_id": task.project_id,
            "project": active_projects[task.project_id].title,
            "title": task.title, "status": str(task.status or "todo"),
            "due_date": due.isoformat() if due else None,
            "overdue": overdue, "critical_path_candidate": critical,
            "predecessor_count": upstream, "successor_count": downstream,
            "estimated_hours": float(estimate) if estimate is not None else None,
            "signal_score": score, "signals": signals,
            "interpretation": "review_candidate" if score >= 3 else "monitor" if score else "no_recorded_bottleneck_signal",
        }
        bottleneck_rows.append(row)
        by_project_tasks[task.project_id].append(row)

    deliverable_map = {d.id: d for d in deliverables if d.project_id in active_projects}
    revision_counts = defaultdict(int)
    for revision in revisions:
        if revision.deliverable_id in deliverable_map:
            revision_counts[revision.deliverable_id] += 1

    revision_rows = []
    by_project_revision = defaultdict(list)
    for deliverable in deliverable_map.values():
        count = revision_counts[deliverable.id]
        additional = max(0, count - 1)
        row = {
            "deliverable_id": deliverable.id, "project_id": deliverable.project_id,
            "project": active_projects[deliverable.project_id].title,
            "task_id": deliverable.task_id, "title": deliverable.title,
            "status": str(deliverable.status or "draft"),
            "revision_versions": count, "additional_revisions_after_initial": additional,
            "revision_activity": "multiple_revisions" if count > 1 else "single_or_unrecorded_revision",
            "review_note_present": bool(str(getattr(deliverable, "review_note", "") or "").strip()),
        }
        revision_rows.append(row)
        by_project_revision[deliverable.project_id].append(row)

    project_rows = []
    for project_id, project in sorted(active_projects.items(), key=lambda item: (item[1].title or "").lower()):
        task_rows = by_project_tasks.get(project_id, [])
        rev_rows = by_project_revision.get(project_id, [])
        multi = sum(1 for r in rev_rows if r["revision_versions"] > 1)
        project_rows.append({
            "project_id": project_id, "project": project.title,
            "open_tasks": len(task_rows),
            "critical_path_candidates": sum(1 for r in task_rows if r["critical_path_candidate"]),
            "overdue_open_tasks": sum(1 for r in task_rows if r["overdue"]),
            "tasks_with_multiple_downstream_dependencies": sum(1 for r in task_rows if r["successor_count"] >= 2),
            "dependency_cycle_detected": project_id in cycle_projects,
            "deliverables": len(rev_rows), "deliverables_with_multiple_revisions": multi,
            "additional_revision_versions": sum(r["additional_revisions_after_initial"] for r in rev_rows),
            "revision_activity_rate_percent": round(100 * multi / len(rev_rows), 1) if rev_rows else None,
            "rework_data_quality": "recorded_revision_history" if any(r["revision_versions"] for r in rev_rows) else "no_deliverable_revision_records",
        })

    bottleneck_rows.sort(key=lambda r: (-r["signal_score"], -r["successor_count"], r["project"].lower(), r["title"].lower()))
    revision_rows.sort(key=lambda r: (-r["additional_revisions_after_initial"], r["project"].lower(), r["title"].lower()))
    return {
        "as_of": today.isoformat(),
        "summary": {
            "active_projects": len(active_projects), "open_tasks_reviewed": len(active_tasks),
            "bottleneck_review_candidates": sum(1 for r in bottleneck_rows if r["interpretation"] == "review_candidate"),
            "overdue_open_tasks": sum(1 for r in bottleneck_rows if r["overdue"]),
            "projects_with_dependency_cycles": len(cycle_projects),
            "deliverables_reviewed": len(revision_rows),
            "deliverables_with_multiple_revisions": sum(1 for r in revision_rows if r["revision_versions"] > 1),
            "additional_revision_versions": sum(r["additional_revisions_after_initial"] for r in revision_rows),
        },
        "projects": project_rows, "bottleneck_candidates": bottleneck_rows,
        "deliverable_revision_activity": revision_rows,
        "method": "Bottleneck candidates use explicit finish-to-start dependency structure, longest-chain membership, successor fan-out and recorded due dates. Revision activity counts immutable deliverable revision snapshots; the initial version is not counted as rework.",
        "limitations": [
            "A high signal score is a deterministic review priority, not a probability or proof of causation.",
            "Task start/blocked timestamps and actual completion latency are not available for all records; dependency structure cannot prove a task caused a project delay.",
            "Deliverable revisions may reflect normal iteration, scope changes or quality improvements; revision count alone does not establish avoidable rework.",
            "Only deliverables with explicit revision records are included; no revisions are inferred from free-text notes.",
            "Cancelled and completed tasks and closed projects are excluded from open bottleneck candidates.",
        ],
    }

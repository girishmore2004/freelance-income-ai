"""Evidence-based effort suggestions from completed, time-tracked tasks.

This is descriptive decision support, not an automatic estimator. It uses only
user-scoped rows supplied by the caller and never writes estimates back.
"""
from collections import defaultdict
from statistics import median
import re

CLOSED = {"done", "completed", "cancelled", "canceled", "archived", "closed"}
EXCLUDED = {"the", "and", "for", "with", "from", "into", "this", "that", "your", "task", "work", "project", "build", "create", "update", "fix", "new"}


def _tokens(task):
    text = f"{getattr(task, 'title', '') or ''} {getattr(task, 'description', '') or ''}"
    words = {w for w in re.findall(r"[a-z0-9+#.]{2,}", text.lower()) if w not in EXCLUDED}
    return words


def _similarity(left, right):
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def _percentile(values, fraction):
    ordered = sorted(float(v) for v in values)
    if not ordered:
        return None
    if len(ordered) == 1:
        return round(ordered[0], 2)
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return round(ordered[lower] * (1 - weight) + ordered[upper] * weight, 2)


def build_adaptive_effort_suggestions(tasks, time_entries, minimum_similarity=0.12, max_history=12):
    hours = defaultdict(float)
    counts = defaultdict(int)
    for entry in time_entries:
        task_id = getattr(entry, "task_id", None)
        minutes = getattr(entry, "duration_minutes", None)
        if task_id and minutes is not None:
            hours[task_id] += max(0, int(minutes)) / 60.0
            counts[task_id] += 1

    history = []
    for task in tasks:
        status = str(getattr(task, "status", "") or "").lower()
        actual = hours.get(task.id, 0.0)
        if status in {"done", "completed"} and counts.get(task.id, 0) and actual > 0:
            tokens = _tokens(task)
            if tokens:
                history.append({"task": task, "hours": round(actual, 2), "tokens": tokens})

    suggestions = []
    for task in tasks:
        status = str(getattr(task, "status", "todo") or "todo").lower()
        if status in CLOSED:
            continue
        target_tokens = _tokens(task)
        if not target_tokens:
            continue
        candidates = []
        for item in history:
            if item["task"].id == task.id:
                continue
            similarity = _similarity(target_tokens, item["tokens"])
            if similarity >= minimum_similarity:
                candidates.append({"hours": item["hours"], "similarity": round(similarity, 3),
                                   "task_id": item["task"].id,
                                   "title": getattr(item["task"], "title", "")})
        candidates.sort(key=lambda row: (-row["similarity"], row["hours"], row["task_id"]))
        candidates = candidates[:max_history]
        values = [row["hours"] for row in candidates]
        n = len(values)
        current = getattr(task, "estimated_hours", None)
        if n >= 2:
            recommended = round(median(values), 2)
            mean = sum(values) / n
            dispersion = (sum((v - mean) ** 2 for v in values) / n) ** 0.5 / mean if mean > 0 else None
            confidence = "high" if n >= 7 and dispersion is not None and dispersion <= 0.60 else "medium" if n >= 3 else "low"
            status_reason = "historical_match"
        else:
            recommended = None
            dispersion = None
            confidence = "insufficient"
            status_reason = "insufficient_similar_history"
        suggestions.append({
            "task_id": task.id, "project_id": getattr(task, "project_id", None),
            "title": getattr(task, "title", ""), "status": status,
            "current_estimated_hours": float(current) if current is not None else None,
            "recommended_hours": recommended,
            "suggested_range_hours": {"low": _percentile(values, 0.25), "high": _percentile(values, 0.75)} if n >= 2 else None,
            "similar_completed_tasks": n, "confidence": confidence,
            "relative_dispersion": round(dispersion, 3) if dispersion is not None else None,
            "matched_history": candidates,
            "reason_code": status_reason,
            "estimate_difference_hours": round(recommended - float(current), 2) if recommended is not None and current is not None else None,
        })

    suggestions.sort(key=lambda row: (row["confidence"] == "insufficient", -row["similar_completed_tasks"], row["title"].lower()))
    sufficient = [row for row in suggestions if row["recommended_hours"] is not None]
    return {
        "summary": {
            "open_tasks_reviewed": len(suggestions),
            "tasks_with_recommendations": len(sufficient),
            "insufficient_history": sum(1 for row in suggestions if row["recommended_hours"] is None),
            "historical_completed_tasks_with_time": len(history),
        },
        "suggestions": suggestions,
        "method": "For each open task, the service finds completed tasks with overlapping title/description terms and recorded task-linked time. The recommended effort is the median of up to 12 most similar records; the range is the 25th–75th percentile.",
        "limitations": [
            "Logged hours are not guaranteed to equal total effort; unlogged work and incomplete time tracking can bias estimates downward.",
            "Text similarity is a deterministic heuristic, not semantic understanding; review matched examples before using a suggestion.",
            "Small samples and high variation reduce confidence. Insufficient history produces no numeric estimate.",
            "Suggestions are read-only and do not change task estimates, schedules, deadlines or client commitments.",
        ],
    }

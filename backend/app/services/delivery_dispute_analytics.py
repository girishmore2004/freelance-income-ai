"""Deterministic descriptive analytics for manually recorded delivery issues."""
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from statistics import median

ROOT_CAUSES = {
    "scope_mismatch", "requirements_unclear", "communication_gap", "quality_defect",
    "dependency_delay", "client_input_delay", "capacity_estimation", "technical_risk",
    "other", "unclassified",
}


def _aware(value):
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _minutes(start, end):
    start, end = _aware(start), _aware(end)
    if not start or not end or end < start:
        return None
    return round((end - start).total_seconds() / 60, 1)


def _median(values):
    clean = [v for v in values if v is not None]
    return round(median(clean), 1) if clean else None


def summarize_delivery_issues(issues, audit_events, as_of=None):
    """Summarize only recorded facts; missing timestamps remain unknown."""
    as_of = _aware(as_of or datetime.now(timezone.utc))
    issue_ids = {row.id for row in issues}
    triaged_at = {}
    for event in audit_events:
        detail = event.detail or ""
        for issue_id in issue_ids:
            if issue_id in detail and "→" in detail and issue_id not in triaged_at:
                # First recorded transition out of open is the observable triage/start timestamp.
                transition = detail.split(";", 1)[0]
                if "open →" in transition:
                    triaged_at[issue_id] = event.created_at
    today = as_of.date()
    by_project = defaultdict(list)
    for issue in issues:
        by_project[issue.project_id].append(issue)

    def summarize(rows):
        severity = Counter(row.severity for row in rows)
        status = Counter(row.status for row in rows)
        causes = Counter((row.root_cause or "unclassified") for row in rows)
        overdue = []
        triage_durations, resolution_durations = [], []
        unresolved = 0
        for row in rows:
            try:
                due = date.fromisoformat(row.due_date) if row.due_date else None
            except ValueError:
                due = None
            if row.status not in {"resolved", "closed"}:
                unresolved += 1
                if due and due < today:
                    overdue.append(row.id)
            triage_durations.append(_minutes(row.created_at, triaged_at.get(row.id)))
            resolution_durations.append(_minutes(row.created_at, row.resolved_at))
        return {
            "issue_count": len(rows), "severity_counts": dict(severity),
            "status_counts": dict(status), "root_cause_counts": dict(causes),
            "unresolved_count": unresolved, "overdue_open_issue_ids": overdue,
            "overdue_open_count": len(overdue),
            "median_minutes_to_triage": _median(triage_durations),
            "triage_sample_count": sum(v is not None for v in triage_durations),
            "median_minutes_to_resolution": _median(resolution_durations),
            "resolution_sample_count": sum(v is not None for v in resolution_durations),
            "sample_quality": "descriptive_only" if len(rows) < 5 else "sample_available",
        }

    return {
        "as_of": as_of.isoformat(),
        "overall": summarize(issues),
        "projects": [{"project_id": project_id, **summarize(rows)}
                     for project_id, rows in sorted(by_project.items())],
        "method": "recorded_issue_events_and_timestamps_only",
    }

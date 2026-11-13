"""Explainable, read-only project delivery health and change-control readiness."""
from collections import Counter, defaultdict
from datetime import date


def _date(value):
    try:
        return date.fromisoformat(str(value)[:10]) if value else None
    except (TypeError, ValueError):
        return None


def build_delivery_health(projects, tasks, deliverables, revisions, feedback_events,
                          issues, audit_result, evidence_coverage, scope_changes, as_of=None):
    """Build transparent rule-based scorecards; never infer missing facts."""
    as_of = as_of or date.today()
    project_map = {p.id: p for p in projects}
    deliverable_map = {d.id: d for d in deliverables if d.project_id in project_map}
    revisions_by_project = defaultdict(list)
    for revision in revisions:
        deliverable = deliverable_map.get(revision.deliverable_id)
        if deliverable and revision.user_id == deliverable.user_id:
            revisions_by_project[deliverable.project_id].append(revision)
    feedback_by_project = defaultdict(list)
    for event in feedback_events:
        deliverable = deliverable_map.get(event.deliverable_id)
        if deliverable and event.user_id == deliverable.user_id:
            feedback_by_project[deliverable.project_id].append(event)
    tasks_by_project, issues_by_project, deliverables_by_project = defaultdict(list), defaultdict(list), defaultdict(list)
    for row in tasks:
        if row.project_id in project_map and row.user_id == project_map[row.project_id].user_id:
            tasks_by_project[row.project_id].append(row)
    for row in issues:
        if row.project_id in project_map and row.user_id == project_map[row.project_id].user_id:
            issues_by_project[row.project_id].append(row)
    for row in deliverables:
        if row.project_id in project_map:
            deliverables_by_project[row.project_id].append(row)
    audit_by_project = {row["project_id"]: row for row in (audit_result or {}).get("projects", [])}
    evidence_by_project = {row["project_id"]: row for row in (evidence_coverage or {}).get("projects", [])}
    changes_by_project = defaultdict(list)
    for change in scope_changes:
        if change.project_id in project_map and change.user_id == project_map[change.project_id].user_id:
            changes_by_project[change.project_id].append(change)

    results = []
    status_counts = Counter()
    for project in sorted(projects, key=lambda p: (p.title or "").lower()):
        project_tasks = tasks_by_project[project.id]
        project_issues = issues_by_project[project.id]
        project_deliverables = deliverables_by_project[project.id]
        project_feedback = feedback_by_project[project.id]
        project_revisions = revisions_by_project[project.id]
        open_tasks = [t for t in project_tasks if t.status not in {"done", "cancelled", "completed"}]
        overdue_tasks = [t for t in open_tasks if (_date(t.due_date) or _date(t.planned_finish_date)) and (_date(t.due_date) or _date(t.planned_finish_date)) < as_of]
        unresolved = [i for i in project_issues if i.status not in {"resolved", "closed"}]
        overdue_issues = [i for i in unresolved if _date(i.due_date) and _date(i.due_date) < as_of]
        severe_issues = [i for i in unresolved if i.severity in {"high", "critical"}]
        requested = [e for e in project_feedback if e.decision == "changes_requested"]
        rejected = [e for e in project_feedback if e.decision == "rejected"]
        audit = audit_by_project.get(project.id)
        evidence = evidence_by_project.get(project.id)
        audit_status = ("no_events" if audit and audit.get("chain_status") == "valid" and audit.get("event_count", 0) == 0 else (audit.get("chain_status") if audit else "no_events"))
        missing_evidence = int((evidence or {}).get("missing", 0))
        mismatched_evidence = int((evidence or {}).get("mismatched", 0))
        unclassified = int((evidence or {}).get("unclassified", 0))
        facts = []
        missing = []
        warnings = []
        if project_tasks:
            facts.append({"type": "recorded_fact", "label": "Task tracking", "detail": f"{len(project_tasks)} tasks recorded; {len(open_tasks)} remain open; {len(overdue_tasks)} open tasks have past due dates."})
        else:
            missing.append("No project tasks are recorded; task delivery health cannot be assessed.")
        if project_deliverables:
            facts.append({"type": "recorded_fact", "label": "Deliverables", "detail": f"{len(project_deliverables)} deliverables and {len(project_revisions)} revision snapshots are recorded."})
        else:
            missing.append("No deliverables are recorded.")
        if project_feedback:
            facts.append({"type": "recorded_fact", "label": "Client decision records", "detail": f"{len(project_feedback)} decisions recorded: {sum(e.decision == 'accepted' for e in project_feedback)} accepted, {len(requested)} changes requested, {len(rejected)} rejected."})
        else:
            missing.append("No deliverable acceptance/feedback decisions are recorded; client acceptance status is unknown.")
        if project_issues:
            facts.append({"type": "user_entered_record", "label": "Delivery issues", "detail": f"{len(project_issues)} issues recorded; {len(unresolved)} unresolved, {len(overdue_issues)} overdue, {len(severe_issues)} unresolved high/critical."})
        else:
            facts.append({"type": "recorded_fact", "label": "Delivery issues", "detail": "No delivery issues are recorded in this workspace; this does not prove that no client concerns exist."})
        if audit and audit_status == "valid":
            facts.append({"type": "integrity_check", "label": "Delivery audit chain", "detail": f"Hash chain verified for {audit.get('event_count', 0)} recorded events."})
        elif audit and audit_status not in {"valid", "no_events"}:
            warnings.append("Delivery audit integrity check reports a chain issue; investigate before relying on this audit history.")
        else:
            missing.append("No delivery audit events are available to verify for this project.")
        if evidence:
            facts.append({"type": "evidence_check", "label": "Revision evidence", "detail": f"{evidence.get('matched', 0)} matched, {missing_evidence} missing and {mismatched_evidence} mismatched required revision evidence links; {unclassified} origins remain unclassified."})
        else:
            missing.append("No revision evidence coverage record is available.")
        if requested or rejected:
            warnings.append(f"Recorded client decisions need review: {len(requested)} changes requested and {len(rejected)} rejected.")
        if overdue_tasks:
            warnings.append(f"{len(overdue_tasks)} open task(s) have a recorded due/planned-finish date before {as_of.isoformat()}.")
        if overdue_issues:
            warnings.append(f"{len(overdue_issues)} unresolved delivery issue(s) have passed their recorded due date.")
        if severe_issues:
            warnings.append(f"{len(severe_issues)} unresolved high/critical delivery issue(s) need owner review.")
        if missing_evidence or mismatched_evidence:
            warnings.append("Required revision evidence is incomplete or mismatched; review the linked source records.")
        if audit and audit_status not in {"valid", "no_events"}:
            status = "needs_attention"
        elif severe_issues or overdue_issues or rejected or mismatched_evidence:
            status = "needs_attention"
        elif overdue_tasks or requested or missing_evidence:
            status = "watch"
        elif not (project_tasks or project_deliverables or project_feedback or project_issues or audit or evidence):
            status = "insufficient_data"
        elif missing:
            status = "insufficient_data"
        else:
            status = "on_track"
        status_counts[status] += 1

        change_rows = []
        for change in sorted(changes_by_project[project.id], key=lambda c: (c.requested_at.isoformat() if c.requested_at else "")):
            missing_fields = []
            if not (change.title or "").strip(): missing_fields.append("title")
            if not (change.description or "").strip(): missing_fields.append("scope description")
            if not (change.reason or "").strip(): missing_fields.append("reason")
            if not (change.request_hash or "").strip(): missing_fields.append("request fingerprint")
            change_rows.append({"id": change.id, "title": change.title, "description": change.description,
                "reason": change.reason, "budget_delta": change.budget_delta, "currency": change.currency,
                "timeline_delta_days": change.timeline_delta_days, "status": change.status,
                "client_accepted": bool(change.client_accepted),
                "client_accepted_at": change.client_accepted_at.isoformat() if change.client_accepted_at else None,
                "decision_note": change.decision_note, "requested_at": change.requested_at.isoformat() if change.requested_at else None,
                "readiness": "complete_for_human_review" if not missing_fields else "incomplete",
                "missing_fields": missing_fields,
                "summary": f"{change.title}: {change.description}. Reason: {change.reason}. Budget impact: {change.budget_delta} {change.currency}; timeline impact: {change.timeline_delta_days} day(s)."})
        results.append({"project_id": project.id, "project": project.title, "health_status": status,
            "signals": {"tasks_total": len(project_tasks), "open_tasks": len(open_tasks), "overdue_tasks": len(overdue_tasks),
                "deliverables": len(project_deliverables), "revision_snapshots": len(project_revisions),
                "feedback_decisions": len(project_feedback), "changes_requested": len(requested), "rejected_decisions": len(rejected),
                "delivery_issues": len(project_issues), "unresolved_issues": len(unresolved), "overdue_issues": len(overdue_issues),
                "unresolved_high_critical_issues": len(severe_issues), "audit_chain_status": audit_status,
                "evidence_missing": missing_evidence, "evidence_mismatched": mismatched_evidence, "unclassified_revisions": unclassified},
            "recorded_facts": facts, "review_warnings": warnings, "missing_data": missing,
            "change_control": {"request_count": len(change_rows), "pending_count": sum(c["status"] in {"draft", "requested", "pending"} for c in change_rows),
                "approved_and_client_accepted_count": sum(c["status"] in {"approved", "accepted"} and c["client_accepted"] for c in change_rows),
                "requests": change_rows}})
    return {"as_of": as_of.isoformat(), "summary": {"projects_reviewed": len(results), "on_track": status_counts["on_track"],
            "watch": status_counts["watch"], "needs_attention": status_counts["needs_attention"],
            "insufficient_data": status_counts["insufficient_data"]}, "projects": results,
        "health_method": "Deterministic rule-based review, not a numeric or AI-generated score. Needs-attention: audit integrity issue, unresolved high/critical issue, overdue issue, rejected decision, or mismatched required evidence. Watch: overdue task, changes-requested feedback, or missing required evidence. Missing inputs prevent an on-track conclusion.",
        "limitations": ["Health labels are internal workflow review signals, not guarantees of delivery or client satisfaction.",
            "User-entered issue severity, root cause, task dates and scope-change details are not independently verified.",
            "No feedback record does not mean the client accepted the work.",
            "A valid hash chain verifies stored event consistency, not the authenticity of external communications.",
            "Change-control summaries are drafts for human review; they do not approve scope, amend a contract or contact a client."]}

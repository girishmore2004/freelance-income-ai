"""Evidence-gated client feedback and delivery quality analytics.

Only explicit acceptance events, handover audit timestamps, revision snapshots and
scope-change records are used. Revision counts alone never imply fault or rework.
"""
from collections import defaultdict
from datetime import datetime, timezone
from statistics import median


def _dt(value):
    if value is None:
        return None
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def build_delivery_quality(projects, deliverables, revisions, acceptance_events,
                           audit_events, scope_changes, minimum_sample=3):
    project_map = {p.id: p for p in projects}
    deliverable_map = {d.id: d for d in deliverables if d.project_id in project_map}
    revisions_by_deliverable = defaultdict(list)
    for rev in revisions:
        if rev.deliverable_id in deliverable_map:
            revisions_by_deliverable[rev.deliverable_id].append(rev)
    events_by_deliverable = defaultdict(list)
    for event in acceptance_events:
        if event.deliverable_id in deliverable_map and event.decision in {"accepted", "changes_requested", "rejected"}:
            events_by_deliverable[event.deliverable_id].append(event)
    deliveries_by_deliverable = defaultdict(list)
    for event in audit_events:
        if event.deliverable_id in deliverable_map and event.event_type == "delivery_recorded":
            stamp = _dt(event.created_at)
            if stamp:
                deliveries_by_deliverable[event.deliverable_id].append(stamp)

    project_stats = defaultdict(lambda: {"decisions": 0, "accepted": 0, "changes_requested": 0,
        "rejected": 0, "cycle_days": [], "deliverables_with_feedback": set(),
        "client_requested_revisions": 0, "internal_improvement_revisions": 0,
        "approved_scope_change_revisions": 0, "other_origin_revisions": 0,
        "revision_count": 0, "unclassified_revisions": 0})
    deliverable_rows = []
    all_cycle_days = []
    for did, deliverable in deliverable_map.items():
        project_id = deliverable.project_id
        stats = project_stats[project_id]
        events = sorted(events_by_deliverable[did], key=lambda e: _dt(e.created_at) or datetime.min.replace(tzinfo=timezone.utc))
        handovers = sorted(deliveries_by_deliverable[did])
        revisions_for_item = sorted(revisions_by_deliverable[did], key=lambda r: (r.version, _dt(r.created_at) or datetime.min.replace(tzinfo=timezone.utc)))
        origin_counts = defaultdict(int)
        for revision in revisions_for_item:
            origin = getattr(revision, "revision_origin", "initial" if revision.version == 1 else "unclassified") or "unclassified"
            if origin != "initial":
                origin_counts[origin if origin in {"client_requested", "internal_improvement", "approved_scope_change", "other"} else "unclassified"] += 1
        # Explicit origin selected when the revision is saved is the only basis for classification.
        stats["revision_count"] += sum(origin_counts.values())
        for origin in ("client_requested", "internal_improvement", "approved_scope_change", "other", "unclassified"):
            key = "other_origin_revisions" if origin == "other" else "unclassified_revisions" if origin == "unclassified" else origin + "_revisions"
            stats[key] += origin_counts[origin]
        cycle_values = []
        used_handovers = set()
        for event in events:
            stats["decisions"] += 1
            stats[event.decision] += 1
            stats["deliverables_with_feedback"].add(did)
            decided = _dt(event.created_at)
            candidates = [(i, stamp) for i, stamp in enumerate(handovers) if i not in used_handovers and decided and stamp <= decided]
            if candidates:
                idx, submitted = candidates[-1]
                used_handovers.add(idx)
                days = max(0.0, (decided - submitted).total_seconds() / 86400)
                cycle_values.append(round(days, 2)); all_cycle_days.append(days); stats["cycle_days"].append(days)
        deliverable_rows.append({"deliverable_id": did, "project_id": project_id,
            "project": project_map[project_id].title, "title": deliverable.title,
            "revision_versions": len(revisions_for_item), "additional_revisions": max(0, len(revisions_for_item)-1),
            "client_change_decisions": sum(1 for e in events if e.decision == "changes_requested"),
            "client_requested_revision_versions": origin_counts["client_requested"],
            "internal_improvement_revision_versions": origin_counts["internal_improvement"],
            "approved_scope_change_revision_versions": origin_counts["approved_scope_change"],
            "other_origin_revision_versions": origin_counts["other"],
            "unclassified_revision_versions": origin_counts["unclassified"],
            "acceptance_cycle_days": cycle_values,
            "feedback_sample": len(events),
            "quality_data_status": "recorded_feedback" if events else "no_recorded_client_feedback"})

    scope_by_project = defaultdict(lambda: {"total": 0, "accepted": 0, "rejected": 0, "pending": 0})
    for change in scope_changes:
        if change.project_id not in project_map:
            continue
        bucket = scope_by_project[change.project_id]
        bucket["total"] += 1
        status = str(change.status or "draft").lower()
        if status in {"accepted", "approved"} or bool(change.client_accepted): bucket["accepted"] += 1
        elif status in {"rejected", "declined"}: bucket["rejected"] += 1
        else: bucket["pending"] += 1

    project_rows = []
    for pid, project in sorted(project_map.items(), key=lambda x: (x[1].title or "").lower()):
        s = project_stats[pid]
        n = s["decisions"]
        cycle = sorted(s["cycle_days"])
        median_days = round(median(cycle), 2) if cycle else None
        scope = scope_by_project[pid]
        project_rows.append({"project_id": pid, "project": project.title,
            "feedback_decisions": n, "accepted": s["accepted"], "changes_requested": s["changes_requested"], "rejected": s["rejected"],
            "acceptance_rate_percent": round(100*s["accepted"]/n, 1) if n >= minimum_sample else None,
            "minimum_sample": minimum_sample, "sample_sufficient": n >= minimum_sample,
            "deliverables_with_feedback": len(s["deliverables_with_feedback"]),
            "median_acceptance_cycle_days": median_days, "acceptance_cycle_observations": len(cycle),
            "additional_revision_versions": s["revision_count"],
            "client_requested_revision_versions": s["client_requested_revisions"],
            "internal_improvement_revision_versions": s["internal_improvement_revisions"],
            "approved_scope_change_revision_versions": s["approved_scope_change_revisions"],
            "other_origin_revision_versions": s["other_origin_revisions"],
            "unclassified_revision_versions": s["unclassified_revisions"],
            "scope_changes": scope,
            "feedback_data_status": "sufficient_sample" if n >= minimum_sample else "small_sample" if n else "no_recorded_feedback"})
    return {"summary": {"projects_reviewed": len(project_rows), "feedback_decisions": sum(r["feedback_decisions"] for r in project_rows),
        "accepted_decisions": sum(r["accepted"] for r in project_rows), "changes_requested_decisions": sum(r["changes_requested"] for r in project_rows),
        "rejected_decisions": sum(r["rejected"] for r in project_rows), "acceptance_cycle_observations": len(all_cycle_days),
        "median_acceptance_cycle_days": round(median(all_cycle_days), 2) if all_cycle_days else None,
        "projects_with_sufficient_feedback_sample": sum(1 for r in project_rows if r["sample_sufficient"])},
        "projects": project_rows, "deliverables": sorted(deliverable_rows, key=lambda r: (r["project"].lower(), r["title"].lower())),
        "method": "Acceptance rate uses explicit client decisions. Cycle time pairs a recorded handover with a subsequent decision for the same deliverable. Revision origin counts use only the explicit origin recorded on each revision; no inference is made from timing or revision counts.",
        "limitations": ["Acceptance rates are withheld below the configured minimum decision sample.",
            "Cycle time is reported only where both a handover audit timestamp and a later client decision timestamp exist; missing dates are not estimated.",
            "Revision origin is counted only when explicitly selected at revision creation; legacy revisions remain unclassified.",
            "Origin labels are user-recorded metadata, not independently verified proof that a client requested or approved a change.",
            "Scope changes are summarized separately from deliverable feedback and are not automatically attributed to a deliverable.",
            "Client communications and contractual actions are not sent or executed by this analytics feature."]}

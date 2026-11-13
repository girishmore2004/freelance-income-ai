"""Evidence-link completeness diagnostics for deliverable revision snapshots.

A matching record reference is not independent proof of the client's identity or
that an external message was genuinely sent; it verifies only internal record links.
"""
from collections import defaultdict

REQUIRED_ORIGINS = {"client_requested", "approved_scope_change"}


def build_revision_evidence_coverage(projects, deliverables, revisions, feedback_events, scope_changes):
    project_map = {p.id: p for p in projects}
    deliverable_map = {d.id: d for d in deliverables if d.project_id in project_map}
    feedback_map = {e.id: e for e in feedback_events}
    scope_map = {s.id: s for s in scope_changes}
    rows = []
    grouped = defaultdict(lambda: {"total": 0, "required": 0, "matched": 0, "missing": 0, "mismatched": 0, "not_required": 0, "unclassified": 0})
    for revision in revisions:
        deliverable = deliverable_map.get(revision.deliverable_id)
        if not deliverable or revision.user_id != deliverable.user_id:
            continue
        project = project_map.get(deliverable.project_id)
        origin = getattr(revision, "revision_origin", "unclassified") or "unclassified"
        if origin not in {"initial", "client_requested", "approved_scope_change", "internal_improvement", "other", "unclassified"}:
            origin = "unclassified"
        feedback_id = getattr(revision, "client_feedback_event_id", None)
        scope_id = getattr(revision, "scope_change_request_id", None)
        status = "not_required"
        reason = "This revision origin does not require a client evidence link."
        if origin == "unclassified":
            status = "unclassified"
            reason = "Revision origin is unknown; evidence requirements are not inferred."
        elif origin in REQUIRED_ORIGINS:
            valid = False
            if (origin == "client_requested" and scope_id) or (origin == "approved_scope_change" and feedback_id):
                status, reason = "mismatched", "Evidence link uses the wrong record type for the selected revision origin."
            elif feedback_id and scope_id:
                status, reason = "mismatched", "Both evidence-link types are populated; expected exactly one matching record."
            elif origin == "client_requested":
                event = feedback_map.get(feedback_id) if feedback_id else None
                valid = bool(event and event.user_id == revision.user_id
                    and event.deliverable_id == revision.deliverable_id
                    and event.revision_version == revision.version
                    and event.content_hash == revision.content_hash
                    and event.decision == "changes_requested")
                if valid:
                    status, reason = "matched", "Linked feedback record matches owner, deliverable, revision, content hash and change-request decision."
                elif feedback_id:
                    status, reason = "mismatched", "Linked feedback record is missing or does not match this revision."
                else:
                    status, reason = "missing", "Client-requested origin has no linked feedback event."
            else:
                change = scope_map.get(scope_id) if scope_id else None
                accepted_status = str(getattr(change, "status", "")).lower() in {"accepted", "approved"} if change else False
                valid = bool(change and change.user_id == revision.user_id
                    and change.project_id == deliverable.project_id
                    and bool(change.client_accepted) and accepted_status)
                if valid:
                    status, reason = "matched", "Linked scope-change record matches owner/project and is marked approved and client-accepted."
                elif scope_id:
                    status, reason = "mismatched", "Linked scope-change record is missing or not approved and client-accepted for this project."
                else:
                    status, reason = "missing", "Approved-scope-change origin has no linked scope-change record."
        bucket = grouped[(project.id, origin)]
        bucket["total"] += 1
        if origin in REQUIRED_ORIGINS:
            bucket["required"] += 1
            if status == "matched": bucket["matched"] += 1
            elif status == "missing": bucket["missing"] += 1
            else: bucket["mismatched"] += 1
        elif status == "unclassified":
            bucket["unclassified"] += 1
        else:
            bucket["not_required"] += 1
        rows.append({"revision_id": revision.id, "project_id": project.id, "project": project.title,
            "deliverable_id": deliverable.id, "deliverable": deliverable.title, "version": revision.version,
            "revision_origin": origin, "evidence_status": status, "client_feedback_event_id": feedback_id,
            "scope_change_request_id": scope_id, "reason": reason})
    project_rows = []
    for project in sorted(project_map.values(), key=lambda p: (p.title or "").lower()):
        groups = []
        totals = {"total": 0, "required": 0, "matched": 0, "missing": 0, "mismatched": 0, "not_required": 0, "unclassified": 0}
        for (pid, origin), values in sorted(grouped.items()):
            if pid != project.id: continue
            groups.append({"revision_origin": origin, **values,
                "coverage_percent": round(100 * values["matched"] / values["required"], 1) if values["required"] else None})
            for key in totals: totals[key] += values[key]
        project_rows.append({"project_id": project.id, "project": project.title, **totals,
            "coverage_percent": round(100 * totals["matched"] / totals["required"], 1) if totals["required"] else None,
            "by_origin": groups})
    required = sum(r["required"] for r in project_rows)
    matched = sum(r["matched"] for r in project_rows)
    return {"summary": {"revisions_reviewed": len(rows), "evidence_required_revisions": required,
        "matched_evidence_revisions": matched, "missing_evidence_revisions": sum(r["missing"] for r in project_rows),
        "mismatched_evidence_revisions": sum(r["mismatched"] for r in project_rows),
        "unclassified_revisions": sum(r["unclassified"] for r in project_rows),
        "evidence_coverage_percent": round(100 * matched / required, 1) if required else None},
        "projects": project_rows, "revisions": sorted(rows, key=lambda r: (r["project"].lower(), r["deliverable"].lower(), r["version"])),
        "method": "Coverage denominator includes only client_requested and approved_scope_change revisions. A link is counted as matched only when its referenced internal record matches the expected owner, project/deliverable, decision and revision hash fields.",
        "limitations": ["A matched internal record reference does not independently authenticate a client or prove that an external message was sent.",
            "Origin labels remain user-recorded metadata; coverage does not establish that the selected origin is factually correct.",
            "Unclassified revisions are excluded from the coverage denominator rather than assumed to need or not need evidence.",
            "Internal-improvement and other origins do not require client evidence links by this rule."]}

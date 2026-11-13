"""Deterministic post-closeout archive manifests and project outcome summaries."""
import hashlib
import json
from collections import defaultdict
from datetime import datetime, timezone


def canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def sha256_json(value):
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def evidence_reference_record(value):
    text = str(value or "").strip()
    return {"reference": text, "reference_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest()} if text else None


def build_archive_manifest(project, snapshot, signoff, closure, audit_events,
                           revisions, feedback_events, issues, scope_changes,
                           invoices, payment_events, cost_entries):
    payment_by_invoice = defaultdict(list)
    for event in payment_events:
        payment_by_invoice[event.invoice_id].append(event)
    evidence = []
    for revision in revisions:
        evidence.append({"kind": "revision_origin_evidence", "record_id": revision.id,
                         **(evidence_reference_record(getattr(revision, "origin_evidence_reference", "")) or {})})
    for event in feedback_events:
        evidence.append({"kind": "client_feedback_evidence", "record_id": event.id,
                         **(evidence_reference_record(event.evidence_reference) or {})})
    for issue in issues:
        evidence.append({"kind": "issue_resolution_evidence", "record_id": issue.id,
                         **(evidence_reference_record(issue.resolution_evidence_reference) or {})})
    for invoice in invoices:
        for event in payment_by_invoice[invoice.id]:
            evidence.append({"kind": "payment_evidence", "record_id": event.id,
                             **(evidence_reference_record(event.evidence_reference) or {})})
    for cost in cost_entries:
        evidence.append({"kind": "cost_evidence", "record_id": cost.id,
                         **(evidence_reference_record(cost.evidence_reference) or {})})
    evidence = sorted(evidence, key=lambda x: (x["kind"], x["record_id"]))

    components = {
        "project": {"id": project.id, "title": project.title, "status": project.status},
        "handover_snapshot": {"id": snapshot.id, "version": snapshot.version, "sha256": snapshot.snapshot_hash},
        "closeout_signoff": {"id": signoff.id, "version": signoff.version,
                             "snapshot_hash": signoff.snapshot_hash,
                             "fingerprint": signoff.closeout_fingerprint,
                             "signed_at": signoff.signed_at.isoformat() if signoff.signed_at else None},
        "closure": {"id": closure.id, "signoff_id": closure.signoff_id,
                    "snapshot_hash": closure.snapshot_hash,
                    "fingerprint": closure.closeout_fingerprint,
                    "closed_at": closure.closed_at.isoformat() if closure.closed_at else None},
        "delivery_audit": [{"id": x.id, "event_hash": x.event_hash,
                            "previous_hash": x.previous_hash} for x in sorted(
                                audit_events, key=lambda x: (x.created_at, x.id))],
         "revision_records": [{"id": x.id, "version": x.version, "content_hash": x.content_hash,
                              "revision_origin": getattr(x, "revision_origin", "unclassified")}
                             for x in sorted(revisions, key=lambda x: (x.deliverable_id, x.version, x.id))],
         "feedback_records": [{"id": x.id, "decision": x.decision, "revision_version": x.revision_version,
                               "content_hash": x.content_hash}
                              for x in sorted(feedback_events, key=lambda x: (x.deliverable_id, x.created_at, x.id))],
         "delivery_issues": [{"id": x.id, "status": x.status, "severity": x.severity,
                             "root_cause": x.root_cause}
                            for x in sorted(issues, key=lambda x: x.id)],
         "scope_changes": [{"id": x.id, "status": x.status, "client_accepted": x.client_accepted}
                           for x in sorted(scope_changes, key=lambda x: x.id)],
        "invoices": [{"id": x.id, "amount": round(float(x.amount or 0), 2), "currency": x.currency,
                      "payment_events": [{"id": e.id, "event_type": e.event_type,
                          "amount": round(float(e.amount or 0), 2), "currency": e.currency,
                          "evidence_reference": getattr(e, "evidence_reference", "")}
                          for e in sorted(payment_by_invoice[x.id], key=lambda e: (e.occurred_at, e.id))]}
                     for x in sorted(invoices, key=lambda x: x.id)],
        "cost_entries": [{"id": x.id, "amount": round(float(x.amount or 0), 2),
                          "currency": x.currency, "evidence_reference": x.evidence_reference}
                         for x in sorted(cost_entries, key=lambda x: x.id)],
        "evidence_references": evidence,
    }
    return {"schema_version": 1, "archive_type": "freelance_project_closeout",
            "project_id": project.id, "created_at": datetime.now(timezone.utc).isoformat(),
            "components": components, "component_sha256": sha256_json(components),
            "disclosures": [
                "This archive manifest records application data and references; it does not embed external evidence files.",
                "Evidence reference hashes fingerprint the reference text, not the contents of linked documents.",
                "Payment events and cost entries are manually recorded and are not bank-verified.",
                "Scope-change status and client-acceptance flags are included; the current scope-change record has no dedicated evidence-reference field.",
                "The archive is an integrity aid, not a legal certificate or proof of contractual completion.",
            ]}


def verify_archive_manifest(stored_manifest, stored_hash):
    actual = sha256_json(stored_manifest)
    components = stored_manifest.get("components", {})
    component_hash = sha256_json(components)
    return {"valid": actual == stored_hash and component_hash == stored_manifest.get("component_sha256"),
            "stored_manifest_sha256": stored_hash, "calculated_manifest_sha256": actual,
            "stored_component_sha256": stored_manifest.get("component_sha256"),
            "calculated_component_sha256": component_hash,
            "checks": {"manifest_hash": actual == stored_hash,
                       "component_hash": component_hash == stored_manifest.get("component_sha256")}}


def build_project_outcome(project, tasks, time_entries, invoices, payment_events,
                          cost_entries, deliverables, revisions, feedback_events,
                          issues, scope_changes, closure):
    payments = defaultdict(list)
    for event in payment_events:
        payments[event.invoice_id].append(event)
    currencies = sorted({x.currency for x in invoices} | {x.currency for x in payment_events} |
                        {x.currency for x in cost_entries})
    financial = []
    for currency in currencies:
        invoice_ids = {x.id for x in invoices if x.currency == currency}
        receipts = sum(float(e.amount or 0) for e in payment_events
                       if e.invoice_id in invoice_ids and e.currency == currency and e.event_type in {"receipt", "payment_received"})
        refunds = sum(float(e.amount or 0) for e in payment_events
                      if e.invoice_id in invoice_ids and e.currency == currency and e.event_type in {"refund", "payment_refunded"})
        costs = sum(float(x.amount or 0) for x in cost_entries if x.currency == currency)
        financial.append({"currency": currency, "recorded_receipts": round(receipts, 2),
                          "recorded_refunds": round(refunds, 2), "net_recorded_cash": round(receipts-refunds, 2),
                          "recorded_direct_costs": round(costs, 2),
                          "cash_contribution_after_recorded_costs": round(receipts-refunds-costs, 2),
                          "invoice_count": sum(1 for x in invoices if x.currency == currency),
                          "payment_event_count": sum(len(payments[x.id]) for x in invoices if x.currency == currency)})
    planned_dates = [x.planned_finish_date for x in tasks if getattr(x, "planned_finish_date", "")]
    completed_dates = [x.completed_at.date().isoformat() for x in tasks if getattr(x, "completed_at", None)]
    task_variances = []
    for task in tasks:
        planned = getattr(task, "planned_finish_date", "") or ""
        completed = task.completed_at.date().isoformat() if getattr(task, "completed_at", None) else ""
        if planned and completed:
            try:
                delta = (datetime.fromisoformat(completed) - datetime.fromisoformat(planned)).days
                task_variances.append({"task_id": task.id, "title": task.title,
                                       "planned_finish": planned, "actual_completion": completed,
                                       "variance_days": delta})
            except ValueError:
                pass
    accepted_latest = 0
    revisions_by_deliverable = defaultdict(list)
    for revision in revisions:
        revisions_by_deliverable[revision.deliverable_id].append(revision)
    for deliverable in deliverables:
        latest = max(revisions_by_deliverable[deliverable.id], key=lambda x: x.version, default=None)
        if latest and any(e.deliverable_id == deliverable.id and e.decision == "accepted"
                          and e.revision_version == latest.version and e.content_hash == latest.content_hash
                          for e in feedback_events):
            accepted_latest += 1
    billable_minutes = sum(x.duration_minutes for x in time_entries if x.billable)
    labor_by_currency = defaultdict(float)
    for entry in time_entries:
        if entry.billable:
            labor_by_currency[entry.currency] += (entry.duration_minutes / 60.0) * float(entry.hourly_rate or 0)
    return {"project_id": project.id, "project_title": project.title,
        "project_status": project.status, "closure_date": closure.closed_at.isoformat() if closure and closure.closed_at else None,
        "schedule": {"planned_task_finish_range": [min(planned_dates), max(planned_dates)] if planned_dates else None,
                     "actual_task_completion_range": [min(completed_dates), max(completed_dates)] if completed_dates else None,
                     "task_finish_variances": task_variances,
                     "tasks_with_both_dates": len(task_variances),
                     "tasks_missing_actual_completion": sum(1 for x in tasks if not getattr(x, "completed_at", None))},
        "financial_by_currency": financial,
        "billable_time": {"minutes": billable_minutes, "hours": round(billable_minutes/60, 2),
                          "estimated_billable_value_by_currency": [
                              {"currency": k, "value": round(v, 2)} for k, v in sorted(labor_by_currency.items())]},
        "delivery_quality": {"deliverable_count": len(deliverables),
            "latest_revision_acceptance_count": accepted_latest,
            "acceptance_coverage": round(accepted_latest/len(deliverables), 4) if deliverables else None,
            "revision_count": len(revisions), "feedback_event_count": len(feedback_events),
            "delivery_issue_count": len(issues),
            "open_delivery_issue_count": sum(1 for x in issues if x.status != "closed"),
            "severity_counts": {s: sum(1 for x in issues if x.severity == s) for s in ("low","medium","high","critical")},
            "scope_change_count": len(scope_changes),
            "scope_changes_not_client_accepted": sum(1 for x in scope_changes if not x.client_accepted)},
        "disclosures": [
            "Cash receipts, refunds and direct costs are manually recorded; no bank reconciliation is performed.",
            "Financial amounts are separated by currency; no FX conversion is performed.",
            "Billable labor value is an estimate from recorded hours and hourly rates, not cash revenue.",
            "Task date comparisons include only tasks with both planned finish and recorded completion timestamps.",
            "Acceptance coverage counts only explicit acceptance matching each deliverable's latest revision version and content hash.",
            "Missing dates, payments, costs or feedback are unknown, not zero-performance evidence.",
        ]}


def build_evidence_reference_report(manifest, revisions, feedback_events, issues,
                                   payment_events, cost_entries):
    """Compare archived reference strings with current source records; never claims file authenticity."""
    specs = [
        ("revision_origin_evidence", revisions, "origin_evidence_reference"),
        ("client_feedback_evidence", feedback_events, "evidence_reference"),
        ("issue_resolution_evidence", issues, "resolution_evidence_reference"),
        ("payment_evidence", payment_events, "evidence_reference"),
        ("cost_evidence", cost_entries, "evidence_reference"),
    ]
    archived = {
        (item.get("kind"), item.get("record_id")): item
        for item in manifest.get("components", {}).get("evidence_references", [])
    }
    results = []
    for kind, rows, attribute in specs:
        for row in rows:
            reference = str(getattr(row, attribute, "") or "").strip()
            item = archived.get((kind, row.id))
            if not reference:
                status = "missing_reference"
            elif not item:
                status = "missing_from_manifest"
            else:
                digest = hashlib.sha256(reference.encode("utf-8")).hexdigest()
                status = "verified_reference_text" if (
                    item.get("reference") == reference and item.get("reference_sha256") == digest
                ) else "reference_mismatch"
            results.append({"kind": kind, "record_id": row.id, "status": status,
                            "reference_sha256": hashlib.sha256(reference.encode("utf-8")).hexdigest() if reference else None})
    source_keys = {(x["kind"], x["record_id"]) for x in results}
    for key in archived:
        if key not in source_keys:
            results.append({"kind": key[0], "record_id": key[1], "status": "source_record_missing",
                            "reference_sha256": archived[key].get("reference_sha256")})
    results.sort(key=lambda x: (x["kind"], x["record_id"]))
    counts = {}
    for item in results:
        counts[item["status"]] = counts.get(item["status"], 0) + 1
    return {
        "checks": results,
        "counts": counts,
        "total": len(results),
        "all_reference_texts_match": all(x["status"] in {"verified_reference_text", "missing_reference"} for x in results),
        "disclosure": "This verifies that reference strings in the archive match current database records. It does not fetch linked files, validate URLs, or prove the authenticity or contents of external evidence.",
    }

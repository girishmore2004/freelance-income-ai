"""Deterministic, versioned delivery handover snapshots.

Snapshots contain recorded workspace facts only. They are previews until explicitly
approved; no client communication or external sharing is performed here.
"""
import hashlib
import json
from datetime import datetime, timezone


def canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def build_handover_payload(project, tasks, deliverables, revisions, feedback_events, issues, scope_changes, audit_integrity, invoices=None, payment_events=None):
    task_by_id = {x.id: x for x in tasks}
    revisions_by_deliverable = {}
    for revision in revisions:
        revisions_by_deliverable.setdefault(revision.deliverable_id, []).append(revision)
    feedback_by_deliverable = {}
    for event in feedback_events:
        feedback_by_deliverable.setdefault(event.deliverable_id, []).append(event)

    from .payment_reconciliation import summarize_events
    payment_by_invoice = {}
    for event in (payment_events or []):
        payment_by_invoice.setdefault(event.invoice_id, []).append(event)
    invoice_rows = []
    for invoice in sorted((invoices or []), key=lambda x: (x.currency, x.invoice_number, x.id)):
        events = payment_by_invoice.get(invoice.id, [])
        totals = summarize_events(events, invoice.amount)
        legacy_paid = not events and invoice.status == "paid"
        if legacy_paid:
            totals.update({"received": round(float(invoice.amount), 2), "net_paid": round(float(invoice.amount), 2),
                           "outstanding": 0.0, "status": "paid", "open_disputes": 0})
        invoice_rows.append({
            "id": invoice.id, "invoice_number": invoice.invoice_number,
            "amount": round(float(invoice.amount or 0), 2), "currency": invoice.currency,
            "due_date": invoice.due_date, "invoice_status": invoice.status,
            "received": totals["received"], "refunded": totals["refunded"],
            "net_paid": totals["net_paid"], "outstanding": totals["outstanding"],
            "open_payment_disputes": totals["open_disputes"],
            "payment_event_count": len(events), "legacy_paid_status_only": legacy_paid,
            "payment_evidence": [{
                "event_id": event.id, "event_type": event.event_type,
                "amount": round(float(event.amount or 0), 2), "currency": event.currency,
                "reference": getattr(event, "reference", ""), "evidence_reference": getattr(event, "evidence_reference", ""),
                "occurred_at": event.occurred_at.isoformat() if event.occurred_at else None,
            } for event in sorted(events, key=lambda x: (x.occurred_at, x.created_at, x.id))],
        })
    deliverable_rows = []
    for item in sorted(deliverables, key=lambda x: (x.title, x.id)):
        versions = sorted(revisions_by_deliverable.get(item.id, []), key=lambda x: x.version)
        latest = versions[-1] if versions else None
        decisions = sorted(feedback_by_deliverable.get(item.id, []), key=lambda x: (x.created_at.isoformat() if x.created_at else "", x.id))
        latest_decision = decisions[-1] if decisions else None
        linked_task = task_by_id.get(item.task_id) if item.task_id else None
        deliverable_rows.append({
            "id": item.id, "title": item.title, "description": item.description,
            "status": item.status, "due_date": item.due_date,
            "content_reference": getattr(item, "content_reference", ""),
            "task": {"id": linked_task.id, "title": linked_task.title, "status": linked_task.status} if linked_task else None,
            "latest_revision": ({
                "id": latest.id, "version": latest.version, "content_hash": latest.content_hash,
                "revision_origin": latest.revision_origin,
                "origin_note": getattr(latest, "origin_note", ""),
                "origin_evidence_reference": getattr(latest, "origin_evidence_reference", ""),
                "client_feedback_event_id": latest.client_feedback_event_id,
                "scope_change_request_id": latest.scope_change_request_id,
            } if latest else None),
            "latest_recorded_client_decision": ({
                "id": latest_decision.id, "decision": latest_decision.decision,
                "revision_version": latest_decision.revision_version,
                "content_hash": latest_decision.content_hash,
                "note": getattr(latest_decision, "note", ""),
                "evidence_reference": getattr(latest_decision, "evidence_reference", ""),
                "created_at": latest_decision.created_at.isoformat() if latest_decision.created_at else None,
            } if latest_decision else None),
            "unknowns": (["no_revision_record"] if not latest else []) + (["no_client_decision_record"] if not latest_decision else []),
        })

    issue_rows = [{
        "id": x.id, "title": x.title, "description": x.description,
        "severity": x.severity, "status": x.status, "root_cause": x.root_cause,
        "assigned_to": x.assigned_to, "corrective_action": x.corrective_action,
        "due_date": x.due_date, "resolution_evidence_reference": x.resolution_evidence_reference,
        "resolution_note": x.resolution_note if x.status in ("resolved", "closed") else "",
    } for x in sorted(issues, key=lambda x: (x.severity, x.created_at, x.id))]
    scope_rows = [{
        "id": x.id, "title": x.title, "status": x.status, "currency": x.currency,
        "budget_delta": x.budget_delta, "timeline_delta_days": x.timeline_delta_days,
        "client_accepted": bool(x.client_accepted),
        "client_accepted_at": x.client_accepted_at.isoformat() if x.client_accepted_at else None,
        "request_hash": x.request_hash,
    } for x in sorted(scope_changes, key=lambda x: (x.requested_at, x.id))]

    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "project": {"id": project.id, "title": project.title, "client_name": project.client_name,
                    "description": project.description, "status": project.status,
                    "due_date": project.due_date, "budget": project.budget, "currency": project.currency},
        "tasks": [{
            "id": x.id, "title": x.title, "status": x.status, "due_date": x.due_date,
            "priority": x.priority,
        } for x in sorted(tasks, key=lambda x: (x.title, x.id))],
        "deliverables": deliverable_rows,
        "delivery_issues": issue_rows,
        "scope_changes": scope_rows,
        "invoice_reconciliation": invoice_rows,
        "audit_integrity": audit_integrity,
        "disclosures": [
            "This is a workspace-generated record, not a client-certified statement.",
            "A missing decision or evidence record is unknown and does not imply acceptance.",
            "User-entered labels and evidence references are not independently verified.",
            "This preview has not been externally delivered or shared.",
        ],
    }


def snapshot_fingerprint(payload):
    stable = dict(payload)
    stable.pop("generated_at", None)
    # Snapshot creation/approval append audit events themselves. Bind audit integrity
    # status separately, but exclude volatile event counts/timestamps from freshness.
    stable.pop("audit_integrity", None)
    raw = canonical_json(stable).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def snapshot_hash(payload):
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()

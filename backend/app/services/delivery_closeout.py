"""Deterministic project closeout checks from explicitly recorded workspace evidence."""
from collections import defaultdict
from .payment_reconciliation import summarize_events

def build_closeout_readiness(project, deliverables, revisions, feedback_events, issues,
                             scope_changes, invoices, payment_events, audit_integrity=None):
    revs=defaultdict(list); feedback=defaultdict(list); payments=defaultdict(list)
    for x in revisions: revs[x.deliverable_id].append(x)
    for x in feedback_events: feedback[x.deliverable_id].append(x)
    for x in payment_events: payments[x.invoice_id].append(x)
    checks=[]
    for d in sorted(deliverables,key=lambda x:(x.title,x.id)):
        versions=sorted(revs[d.id],key=lambda x:x.version); latest=versions[-1] if versions else None
        accepted=[e for e in feedback[d.id] if latest and e.decision=="accepted"
                  and e.revision_version==latest.version and e.content_hash==latest.content_hash]
        event=max(accepted,key=lambda x:(x.created_at,x.id)) if accepted else None
        checks.append({"deliverable_id":d.id,"title":d.title,
          "latest_revision_id":latest.id if latest else None,
          "latest_revision_version":latest.version if latest else None,
          "client_acceptance_recorded_for_latest_revision":bool(event),
          "acceptance_event_id":event.id if event else None,
          "status":"accepted" if event else ("missing_revision" if not latest else "acceptance_unknown")})
    open_issues=[x for x in issues if x.status!="closed"]
    unresolved_scope=[x for x in scope_changes if not
        (x.status=="approved" and bool(x.client_accepted) and x.client_accepted_at)]
    invoice_checks=[]
    for inv in sorted(invoices,key=lambda x:(x.currency,x.invoice_number,x.id)):
        events=payments[inv.id]; totals=summarize_events(events,inv.amount)
        legacy=not events and inv.status=="paid"
        if legacy:
            totals.update({"received":round(float(inv.amount),2),"net_paid":round(float(inv.amount),2),
                           "outstanding":0.0,"status":"paid","open_disputes":0})
        invoice_checks.append({"invoice_id":inv.id,"invoice_number":inv.invoice_number,
          "currency":inv.currency,"amount":round(float(inv.amount or 0),2),
          "net_paid":totals["net_paid"],"outstanding":totals["outstanding"],
          "open_payment_disputes":totals["open_disputes"],"legacy_paid_status_only":legacy,
          "payment_event_count":len(events),"status":totals["status"]})
    blockers=[]
    if not deliverables: blockers.append("no_deliverables_recorded")
    blockers += [f"deliverable_acceptance_not_confirmed:{x['deliverable_id']}" for x in checks if x["status"]!="accepted"]
    if open_issues: blockers.append("open_delivery_issues")
    if unresolved_scope: blockers.append("scope_changes_not_approved_and_client_accepted")
    if not invoices: blockers.append("no_invoice_records")
    if any(x["outstanding"]>0 for x in invoice_checks): blockers.append("invoice_balance_outstanding")
    if any(x["open_payment_disputes"]>0 for x in invoice_checks): blockers.append("open_payment_disputes")
    audit_projects = (audit_integrity or {}).get("projects", [])
    matching_audit = [x for x in audit_projects if x.get("project_id") == project.id]
    audit_valid = bool(matching_audit) and all(x.get("chain_status") == "valid" for x in matching_audit)
    if not audit_valid:
        blockers.append("delivery_audit_integrity_not_verified")
    return {"project_id":project.id,"project_title":project.title,
      "status":"ready_for_human_closeout_review" if not blockers else "not_ready",
      "ready":not blockers,"deliverable_checks":checks,"open_delivery_issue_count":len(open_issues),
      "unresolved_scope_change_count":len(unresolved_scope),"invoice_checks":invoice_checks,
      "blockers":blockers,"disclosures":[
       "Readiness is a deterministic workspace checklist, not a legal or contractual completion certificate.",
       "Client acceptance counts only when an explicit accepted event matches the latest revision version and content hash.",
       "Invoice balances use manually recorded payment events; no bank or payment processor verification occurs.",
       "Legacy paid status without ledger events is displayed as legacy status only, not independently verified payment.",
       "Currencies remain separate; no FX conversion is performed.",
       "Ready means ready for human review, not automatic project closure or client notification."]}

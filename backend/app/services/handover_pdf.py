"""Printable PDF rendering for an already-approved immutable handover snapshot."""
from io import BytesIO
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

def _p(value, style):
    text = "—" if value in (None, "") else str(value)
    return Paragraph(escape(text).replace("\n", "<br/>"), style)

def build_handover_pdf(snapshot, snapshot_id, version, snapshot_hash_value, approved_at):
    out=BytesIO()
    doc=SimpleDocTemplate(out,pagesize=A4,rightMargin=15*mm,leftMargin=15*mm,
      topMargin=16*mm,bottomMargin=16*mm,title="Project handover")
    styles=getSampleStyleSheet()
    styles.add(ParagraphStyle(name="CellSmall",parent=styles["BodyText"],fontSize=7.5,leading=9))
    styles.add(ParagraphStyle(name="Disclosure",parent=styles["BodyText"],fontSize=8,leading=10))
    project=snapshot.get("project",{}); story=[]
    story += [Paragraph("PROJECT HANDOVER PACK",styles["Title"]),
      Paragraph(escape(str(project.get("title") or "Project")),styles["Heading1"]),
      _p("Client: "+str(project.get("client_name") or "Not recorded"),styles["Normal"]),
      _p(f"Snapshot v{version} · Approved: {approved_at or 'Not recorded'}",styles["Normal"]),
      _p("Snapshot ID: "+snapshot_id,styles["BodyText"]),
      _p("SHA-256: "+snapshot_hash_value,styles["Disclosure"]),Spacer(1,8),
      Paragraph("Project summary",styles["Heading2"]),
      _p(project.get("description"),styles["BodyText"]),
      _p(f"Status: {project.get('status')} · Due: {project.get('due_date') or 'Not recorded'} · Budget: {project.get('currency')} {project.get('budget')}",styles["Normal"]),
      Paragraph("Deliverables and client decisions",styles["Heading2"])]
    rows=[[_p("Deliverable",styles["CellSmall"]),_p("Status",styles["CellSmall"]),
      _p("Revision",styles["CellSmall"]),_p("Recorded decision",styles["CellSmall"])]]
    for item in snapshot.get("deliverables",[]):
        rev=item.get("latest_revision") or {}; decision=item.get("latest_recorded_client_decision") or {}
        rows.append([_p(item.get("title"),styles["CellSmall"]),_p(item.get("status"),styles["CellSmall"]),
          _p(f"v{rev.get('version')} · {str(rev.get('content_hash',''))[:16]}" if rev else "No revision",styles["CellSmall"]),
          _p((decision.get("decision") + " · evidence: " + str(decision.get("evidence_reference") or "not recorded")) if decision else "Unknown / not recorded",styles["CellSmall"])])
    if len(rows)==1: rows.append([_p("No deliverables recorded",styles["CellSmall"]),"","",""])
    t=Table(rows,colWidths=[48*mm,27*mm,42*mm,57*mm],repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#E8EDF3")),
      ("GRID",(0,0),(-1,-1),.35,colors.HexColor("#C8D0D8")),("VALIGN",(0,0),(-1,-1),"TOP"),("PADDING",(0,0),(-1,-1),5)]))
    story += [t,Paragraph("Open delivery issues",styles["Heading2"])]
    issues=[x for x in snapshot.get("delivery_issues",[]) if x.get("status")!="closed"]
    if issues:
        for x in issues:
            story.append(_p(f"{x.get('title')} · {x.get('severity')} / {x.get('status')} · Due: {x.get('due_date') or 'Not recorded'} · Action: {x.get('corrective_action') or 'Not recorded'}",styles["Disclosure"]))
    else: story.append(_p("No open delivery issues recorded.",styles["Normal"]))
    story.append(Paragraph("Scope changes",styles["Heading2"]))
    for x in snapshot.get("scope_changes",[]):
        story.append(_p(f"{x.get('title')} · {x.get('status')} · client accepted: {x.get('client_accepted')} · {x.get('currency')} {x.get('budget_delta')} · {x.get('timeline_delta_days')} days",styles["Disclosure"]))
    if not snapshot.get("scope_changes"): story.append(_p("No scope-change records.",styles["Normal"]))
    story.append(Paragraph("Invoice reconciliation (manually recorded)",styles["Heading2"]))
    invrows=[[_p("Invoice",styles["CellSmall"]),_p("Currency",styles["CellSmall"]),
      _p("Amount",styles["CellSmall"]),_p("Net paid",styles["CellSmall"]),_p("Outstanding",styles["CellSmall"])]]
    for x in snapshot.get("invoice_reconciliation",[]):
        invrows.append([_p(x.get("invoice_number"),styles["CellSmall"]),_p(x.get("currency"),styles["CellSmall"]),
          _p(x.get("amount"),styles["CellSmall"]),_p(x.get("net_paid"),styles["CellSmall"]),_p(x.get("outstanding"),styles["CellSmall"])])
    if len(invrows)==1: invrows.append([_p("No invoice records",styles["CellSmall"]),"","","",""])
    t=Table(invrows,colWidths=[48*mm,24*mm,33*mm,33*mm,36*mm],repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#E8EDF3")),
      ("GRID",(0,0),(-1,-1),.35,colors.HexColor("#C8D0D8")),("VALIGN",(0,0),(-1,-1),"TOP"),("PADDING",(0,0),(-1,-1),5)]))
    story += [t]
    payment_evidence = [(inv, event) for inv in snapshot.get("invoice_reconciliation", [])
                        for event in inv.get("payment_evidence", [])]
    story.append(Paragraph("Payment evidence references",styles["Heading3"]))
    if payment_evidence:
        for inv, event in payment_evidence:
            story.append(_p(f"{inv.get('invoice_number')} · {event.get('event_type')} · {event.get('currency')} {event.get('amount')} · ref: {event.get('reference') or 'not recorded'} · evidence: {event.get('evidence_reference') or 'not recorded'} · event: {event.get('event_id')}",styles["Disclosure"]))
    else:
        story.append(_p("No payment ledger events recorded. Legacy invoice statuses, if any, are not bank-verified.",styles["Disclosure"]))
    story.append(Paragraph("Important disclosures",styles["Heading2"]))
    for disclosure in snapshot.get("disclosures",[]): story.append(_p("• "+disclosure,styles["Disclosure"]))
    story.append(Spacer(1,6))
    story.append(_p("Workspace-generated record only. Not a contract, legal completion certificate, proof of bank settlement, or client-certified statement. Verify all records with the relevant parties.",styles["Disclosure"]))
    doc.build(story)
    return out.getvalue()

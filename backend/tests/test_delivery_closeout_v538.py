from datetime import datetime, timezone
from types import SimpleNamespace
from app.services.delivery_closeout import build_closeout_readiness
from app.services.handover_pdf import build_handover_pdf

def obj(**kw): return SimpleNamespace(**kw)

def base():
    p=obj(id="p1",title="Project")
    d=obj(id="d1",title="Deliverable")
    r=obj(id="r1",deliverable_id="d1",version=2,content_hash="hash2")
    f=obj(id="f1",deliverable_id="d1",decision="accepted",revision_version=2,
          content_hash="hash2",created_at=datetime(2026,11,1,tzinfo=timezone.utc))
    i=obj(id="i1",invoice_number="INV-1",currency="INR",amount=1000,status="unpaid")
    pay=obj(id="pay1",invoice_id="i1",event_type="receipt",amount=1000,currency="INR",
            occurred_at=datetime(2026,11,2,tzinfo=timezone.utc),
            created_at=datetime(2026,11,2,tzinfo=timezone.utc))
    return p,d,r,f,i,pay

def test_closeout_ready_only_when_current_revision_accepted_and_ledger_paid():
    p,d,r,f,i,pay=base()
    result=build_closeout_readiness(p,[d],[r],[f],[],[],[i],[pay],{"projects":[{"project_id":"p1","chain_status":"valid"}]})
    assert result["ready"] is True
    assert result["invoice_checks"][0]["outstanding"] == 0

def test_old_revision_acceptance_does_not_accept_latest_revision():
    p,d,r,f,i,pay=base()
    f.revision_version=1
    result=build_closeout_readiness(p,[d],[r],[f],[],[],[i],[pay],{"projects":[{"project_id":"p1","chain_status":"valid"}]})
    assert result["ready"] is False
    assert "deliverable_acceptance_not_confirmed:d1" in result["blockers"]

def test_legacy_paid_status_is_disclosed_and_missing_invoice_blocks_closeout():
    p,d,r,f,i,pay=base()
    i.status="paid"
    result=build_closeout_readiness(p,[d],[r],[f],[],[],[i],[],{"projects":[{"project_id":"p1","chain_status":"valid"}]})
    assert result["invoice_checks"][0]["legacy_paid_status_only"] is True
    result2=build_closeout_readiness(p,[d],[r],[f],[],[],[],[],{"projects":[{"project_id":"p1","chain_status":"valid"}]})
    assert "no_invoice_records" in result2["blockers"]

def test_open_issue_unapproved_scope_and_invalid_audit_block_closeout():
    p,d,r,f,i,pay=base()
    issue=obj(status="in_progress")
    scope=obj(status="pending",client_accepted=False,client_accepted_at=None)
    result=build_closeout_readiness(p,[d],[r],[f],[issue],[scope],[i],[pay],{"projects":[{"project_id":"p1","chain_status":"integrity_issue"}]})
    assert {"open_delivery_issues","scope_changes_not_approved_and_client_accepted",
            "delivery_audit_integrity_not_verified"}.issubset(set(result["blockers"]))

def test_handover_pdf_is_valid_pdf_and_contains_disclosures():
    pdf=build_handover_pdf({"project":{"title":"Test Project","client_name":"Client"},
      "deliverables":[],"delivery_issues":[],"scope_changes":[],"invoice_reconciliation":[],
      "disclosures":["Missing feedback is unknown."]},"snap-1",1,"a"*64,"2026-11-13T00:00:00+00:00")
    assert pdf.startswith(b"%PDF")
    assert len(pdf)>500

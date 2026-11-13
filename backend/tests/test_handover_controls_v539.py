from datetime import datetime, timezone, timedelta
from types import SimpleNamespace
import copy
import pytest
from app.services.handover_controls import build_redaction_preview, build_retention_preview


def test_redaction_preview_changes_copy_without_mutating_source():
    source={"project":{"client_name":"Acme"},"invoice_reconciliation":[{"invoice_number":"INV-1","payment_evidence":[{"reference":"BANK-REF","evidence_reference":"receipt.pdf"}]}]}
    before=copy.deepcopy(source)
    result=build_redaction_preview(source,{})
    assert source==before
    assert result["redacted_preview"]["project"]["client_name"]=="[REDACTED]"
    assert result["redacted_preview"]["invoice_reconciliation"][0]["invoice_number"]=="[REDACTED]"
    assert result["redacted_preview"]["invoice_reconciliation"][0]["payment_evidence"][0]["reference"]=="[REDACTED]"
    assert result["redacted_preview_hash"]


def test_redaction_preview_respects_explicit_options():
    source={"project":{"client_name":"Acme","description":"Secret"},"invoice_reconciliation":[{"invoice_number":"INV-2"}]}
    result=build_redaction_preview(source,{"redact_client_name":False,"redact_invoice_numbers":False,"redact_evidence_references":False,"redact_free_text":True})
    preview=result["redacted_preview"]
    assert preview["project"]["client_name"]=="Acme"
    assert preview["project"]["description"]=="[REDACTED]"
    assert preview["invoice_reconciliation"][0]["invoice_number"]=="INV-2"


def test_retention_preview_is_non_destructive_and_calculates_review_date():
    row=SimpleNamespace(id="s1",version=2,status="approved",created_at=datetime(2026,1,1,tzinfo=timezone.utc))
    result=build_retention_preview(row,365,datetime(2026,6,1,tzinfo=timezone.utc))
    assert result["review_eligible_at"].startswith("2027-01-01")
    assert result["review_eligible"] is False
    assert result["action"]=="review_only_no_deletion"


def test_retention_preview_rejects_out_of_policy_range():
    row=SimpleNamespace(id="s1",version=1,status="draft",created_at=datetime.now(timezone.utc))
    with pytest.raises(ValueError):
        build_retention_preview(row,10)


def test_closeout_schema_and_routes_are_append_only_and_explicit():
    from pathlib import Path
    root=Path(__file__).parents[1]
    models=(root/"app/models.py").read_text()
    main=(root/"app/main.py").read_text()
    migration=(root/"alembic/versions/0041_closeout_signoff_and_closure.py").read_text()
    assert "class DeliveryCloseoutSignoff(Base)" in models
    assert "class ProjectClosureRecord(Base)" in models
    assert 'confirmation_phrase") != "SIGN OFF CLOSEOUT"' in main
    assert 'confirmation_phrase") != "CLOSE PROJECT"' in main
    assert 'project.status = "completed"' in main
    assert 'down_revision = "0040_delivery_handover_snapshots"' in migration
    assert '@app.post("/api/v1/projects/{project_id}/closeout-signoffs")' in main
    assert '@app.post("/api/v1/projects/{project_id}/close")' in main
    assert '@app.get("/api/v1/handover-snapshots/{snapshot_id}/retention-preview")' in main
    assert '@app.post("/api/v1/handover-snapshots/{snapshot_id}/redaction-preview")' in main
    assert 'def get_project_closure_record' in main

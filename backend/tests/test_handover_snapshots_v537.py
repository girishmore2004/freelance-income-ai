from datetime import datetime, timezone
from types import SimpleNamespace

from app.services.handover_snapshots import (
    build_handover_payload, snapshot_fingerprint, snapshot_hash,
)


def row(**kwargs):
    return SimpleNamespace(**kwargs)


def test_handover_snapshot_contains_recorded_facts_and_unknowns():
    project = row(id="p1", title="Website", client_name="Client", description="Build",
                  status="active", due_date="2026-12-01", budget=1000, currency="INR")
    deliverable = row(id="d1", title="Landing page", description="Homepage",
                      status="approved", due_date="", task_id=None)
    revision = row(id="r1", deliverable_id="d1", version=2, title="Landing page",
                   content_hash="abc123", revision_origin="client_requested",
                   client_feedback_event_id="f1", scope_change_request_id=None)
    feedback = row(id="f1", deliverable_id="d1", revision_version=2,
                   content_hash="abc123", decision="changes_requested",
                   created_at=datetime(2026, 11, 1, tzinfo=timezone.utc))
    payload = build_handover_payload(project, [], [deliverable], [revision], [feedback],
                                     [], [], {"projects_checked": 1, "integrity": "valid"})
    item = payload["deliverables"][0]
    assert item["latest_revision"]["id"] == "r1"
    assert item["latest_recorded_client_decision"]["decision"] == "changes_requested"
    assert item["latest_revision"]["client_feedback_event_id"] == "f1"
    assert "no_revision_record" not in item["unknowns"]
    assert "no_client_decision_record" not in item["unknowns"]


def test_handover_snapshot_does_not_infer_acceptance_when_feedback_missing():
    project = row(id="p1", title="P", client_name="", description="", status="active",
                  due_date="", budget=0, currency="INR")
    deliverable = row(id="d1", title="D", description="", status="draft", due_date="", task_id=None)
    payload = build_handover_payload(project, [], [deliverable], [], [], [], [], {})
    item = payload["deliverables"][0]
    assert item["latest_recorded_client_decision"] is None
    assert "no_client_decision_record" in item["unknowns"]
    assert any("does not imply acceptance" in x for x in payload["disclosures"])


def test_fingerprint_ignores_generation_timestamp_but_hash_binds_exact_snapshot():
    a = {"generated_at": "2026-01-01T00:00:00+00:00", "project": {"id": "p"}}
    b = {"generated_at": "2026-01-02T00:00:00+00:00", "project": {"id": "p"}}
    assert snapshot_fingerprint(a) == snapshot_fingerprint(b)
    assert snapshot_hash(a) != snapshot_hash(b)


def test_snapshot_hash_changes_when_content_changes():
    a = {"project": {"id": "p"}, "disclosures": []}
    b = {"project": {"id": "p"}, "disclosures": ["additional note"]}
    assert snapshot_hash(a) != snapshot_hash(b)


def test_handover_snapshot_includes_currency_isolated_invoice_reconciliation():
    project = row(id="p1", title="P", client_name="", description="", status="active",
                  due_date="", budget=0, currency="INR")
    invoice = row(id="i1", invoice_number="INV-1", amount=1000, currency="INR",
                  due_date="2026-11-20", status="unpaid")
    payment = row(id="pay1", invoice_id="i1", event_type="receipt", amount=400,
                  currency="INR", occurred_at=datetime(2026, 11, 2, tzinfo=timezone.utc),
                  created_at=datetime(2026, 11, 2, tzinfo=timezone.utc))
    payload = build_handover_payload(project, [], [], [], [], [], [], {}, [invoice], [payment])
    result = payload["invoice_reconciliation"][0]
    assert result["net_paid"] == 400
    assert result["outstanding"] == 600
    assert result["currency"] == "INR"
    assert result["payment_evidence"][0]["event_id"] == "pay1"

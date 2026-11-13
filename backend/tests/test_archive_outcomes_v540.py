from datetime import datetime, timezone
from types import SimpleNamespace
from app.services.archive_outcomes import (
    build_archive_manifest, build_project_outcome, sha256_json, verify_archive_manifest,
)

def row(**values):
    return SimpleNamespace(**values)

def test_archive_manifest_fingerprints_snapshot_signoff_closure_and_evidence_refs():
    now = datetime(2026, 11, 13, tzinfo=timezone.utc)
    project = row(id="p1", title="Project", status="completed")
    snapshot = row(id="s1", version=2, snapshot_hash="a" * 64)
    signoff = row(id="so1", version=1, snapshot_hash="a" * 64,
                  closeout_fingerprint="b" * 64, signed_at=now)
    closure = row(id="c1", signoff_id="so1", snapshot_hash="a" * 64,
                  closeout_fingerprint="b" * 64, closed_at=now)
    revision = row(id="r1", deliverable_id="d1", version=2, content_hash="c" * 64,
                   revision_origin="client_requested", origin_evidence_reference="ticket-123")
    feedback = row(id="f1", deliverable_id="d1", created_at=now, decision="accepted", revision_version=2,
                   content_hash="c" * 64, evidence_reference="acceptance-email")
    manifest = build_archive_manifest(project, snapshot, signoff, closure, [], [revision],
        [feedback], [], [], [], [], [])
    assert manifest["components"]["handover_snapshot"]["sha256"] == "a" * 64
    assert any(x["reference_sha256"] for x in manifest["components"]["evidence_references"])
    digest = sha256_json(manifest)
    assert verify_archive_manifest(manifest, digest)["valid"] is True
    changed = dict(manifest)
    changed["project_id"] = "tampered"
    assert verify_archive_manifest(changed, digest)["valid"] is False

def test_outcome_financials_are_currency_isolated_and_use_manual_events():
    project = row(id="p1", title="Project", status="completed")
    closure = row(closed_at=datetime(2026, 11, 13, tzinfo=timezone.utc))
    invoice = row(id="i1", currency="INR")
    payment = row(invoice_id="i1", currency="INR", event_type="receipt", amount=500)
    cost = row(currency="INR", amount=100)
    result = build_project_outcome(project, [], [], [invoice], [payment], [cost],
        [], [], [], [], [], closure)
    assert result["financial_by_currency"] == [{
        "currency": "INR", "recorded_receipts": 500.0, "recorded_refunds": 0,
        "net_recorded_cash": 500.0, "recorded_direct_costs": 100.0,
        "cash_contribution_after_recorded_costs": 400.0,
        "invoice_count": 1, "payment_event_count": 1
    }]

def test_outcome_acceptance_requires_latest_revision_hash_match():
    project = row(id="p1", title="Project", status="completed")
    closure = row(closed_at=None)
    deliverable = row(id="d1")
    revision = row(id="r1", deliverable_id="d1", version=3, content_hash="latest")
    stale = row(deliverable_id="d1", decision="accepted", revision_version=2, content_hash="old")
    result = build_project_outcome(project, [], [], [], [], [], [deliverable],
        [revision], [stale], [], [], closure)
    assert result["delivery_quality"]["latest_revision_acceptance_count"] == 0
    assert result["delivery_quality"]["acceptance_coverage"] == 0.0

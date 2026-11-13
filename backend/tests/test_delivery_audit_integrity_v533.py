from datetime import datetime, timezone, timedelta
from types import SimpleNamespace

from app.services.delivery_audit_integrity import calculate_audit_event_hash, verify_delivery_audit_chains


def event(event_id, previous="", detail="created", minute=0):
    row = SimpleNamespace(id=event_id, user_id="u1", project_id="p1", deliverable_id="d1",
                          event_type="deliverable_created", detail=detail,
                          created_at=datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(minutes=minute),
                          previous_hash=previous, event_hash="", chain_version=1)
    row.event_hash = calculate_audit_event_hash(row, previous)
    return row


def test_valid_chain_passes_and_reports_head():
    first = event("e1")
    second = event("e2", first.event_hash, "review requested", 1)
    result = verify_delivery_audit_chains([second, first])
    assert result["summary"]["valid_projects"] == 1
    assert result["projects"][0]["chain_status"] == "valid"
    assert result["projects"][0]["head_hash"] == second.event_hash


def test_tampered_event_is_detected():
    first = event("e1")
    second = event("e2", first.event_hash, "review requested", 1)
    second.detail = "rewritten after the fact"
    result = verify_delivery_audit_chains([first, second])
    assert result["summary"]["projects_with_integrity_issues"] == 1
    assert result["projects"][0]["issues"]


def test_removed_middle_event_breaks_following_link():
    first = event("e1")
    second = event("e2", first.event_hash, "middle", 1)
    third = event("e3", second.event_hash, "last", 2)
    result = verify_delivery_audit_chains([first, third])
    assert result["projects"][0]["chain_status"] == "integrity_issue"


def test_chains_are_isolated_by_project():
    first = event("e1")
    other = SimpleNamespace(**{**first.__dict__, "id": "e-other", "project_id": "p2", "previous_hash": ""})
    other.event_hash = calculate_audit_event_hash(other, "")
    result = verify_delivery_audit_chains([first, other])
    assert result["summary"]["projects_checked"] == 2
    assert result["summary"]["valid_projects"] == 2


def test_migration_follows_revision_evidence_links():
    from pathlib import Path
    migration = Path(__file__).parents[1] / "alembic" / "versions" / "0037_delivery_audit_hash_chain.py"
    source = migration.read_text()
    assert 'down_revision = "0036_revision_evidence_links"' in source
    assert "UPDATE delivery_audit_events" in source
    assert 'event_hash' in source and 'previous_hash' in source


def test_all_delivery_audit_writes_use_the_hash_chain_append_helper():
    from pathlib import Path
    source = (Path(__file__).parents[1] / "app" / "main.py").read_text()
    assert "def _add_delivery_audit_event" in source
    # Existing write paths plus issue, handover, closeout sign-off and project closure events.
    assert source.count("_add_delivery_audit_event(db,") == 15
    assert "DeliveryAuditEvent(" in source
    assert source.count("DeliveryAuditEvent(") == 1


def test_runtime_and_migration_use_canonical_utc_timestamps():
    from datetime import datetime, timezone
    from pathlib import Path
    from app.services.delivery_audit_integrity import _canonical_timestamp
    stamp = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert _canonical_timestamp(stamp) == _canonical_timestamp("2026-01-01 00:00:00+00:00")
    migration = Path(__file__).parents[1] / "alembic" / "versions" / "0037_delivery_audit_hash_chain.py"
    assert "_canonical_timestamp(row[\"created_at\"])" in migration.read_text()


def test_project_head_detects_tail_truncation():
    first = event("e1")
    second = event("e2", first.event_hash, "final event", 1)
    result = verify_delivery_audit_chains([first], {("u1", "p1"): second.event_hash})
    assert result["projects"][0]["chain_status"] == "integrity_issue"
    assert result["projects"][0]["stored_project_head_matches"] is False


def test_project_head_detects_removal_of_entire_chain():
    result = verify_delivery_audit_chains([], {("u1", "p1"): "a" * 64})
    assert result["projects"][0]["event_count"] == 0
    assert result["projects"][0]["chain_status"] == "integrity_issue"

from datetime import datetime, timezone
from types import SimpleNamespace as NS

from app.services.delivery_quality import build_delivery_quality


def test_revision_origins_are_explicit_and_legacy_records_stay_unclassified():
    project = NS(id="p", title="Client portal")
    deliverable = NS(id="d", project_id="p", title="Dashboard")
    revisions = [
        NS(id="r1", deliverable_id="d", version=1, revision_origin="initial", created_at=datetime.now(timezone.utc)),
        NS(id="r2", deliverable_id="d", version=2, revision_origin="client_requested", created_at=datetime.now(timezone.utc)),
        NS(id="r3", deliverable_id="d", version=3, revision_origin="internal_improvement", created_at=datetime.now(timezone.utc)),
        NS(id="r4", deliverable_id="d", version=4, revision_origin="approved_scope_change", created_at=datetime.now(timezone.utc)),
        NS(id="r5", deliverable_id="d", version=5, revision_origin="unclassified", created_at=datetime.now(timezone.utc)),
    ]
    result = build_delivery_quality([project], [deliverable], revisions, [], [], [])
    row = result["deliverables"][0]
    assert row["client_requested_revision_versions"] == 1
    assert row["internal_improvement_revision_versions"] == 1
    assert row["approved_scope_change_revision_versions"] == 1
    assert row["unclassified_revision_versions"] == 1
    assert row["additional_revisions"] == 4
    assert "no inference is made from timing" in result["method"]


def test_missing_origin_field_is_not_guessed_from_client_change_timing():
    project = NS(id="p", title="API")
    deliverable = NS(id="d", project_id="p", title="API")
    revisions = [NS(id="r1", deliverable_id="d", version=1, created_at=datetime.now(timezone.utc)), NS(id="r2", deliverable_id="d", version=2, created_at=datetime.now(timezone.utc))]
    result = build_delivery_quality([project], [deliverable], revisions, [], [], [])
    assert result["deliverables"][0]["unclassified_revision_versions"] == 1
    assert result["deliverables"][0]["client_requested_revision_versions"] == 0

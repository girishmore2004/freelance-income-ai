from datetime import datetime, timezone, timedelta
from types import SimpleNamespace as NS

from app.services.delivery_quality import build_delivery_quality

BASE = datetime(2026, 11, 1, 10, tzinfo=timezone.utc)


def test_acceptance_rate_requires_minimum_sample_and_cycle_requires_both_timestamps():
    project = NS(id="p1", title="Portal")
    deliverable = NS(id="d1", project_id="p1", title="Dashboard")
    decisions = [NS(id=f"a{i}", deliverable_id="d1", revision_version=1,
                    decision="accepted" if i < 2 else "changes_requested", created_at=BASE + timedelta(days=i+2))
                 for i in range(3)]
    audits = [NS(id="h1", deliverable_id="d1", event_type="delivery_recorded", created_at=BASE + timedelta(days=1))]
    result = build_delivery_quality([project], [deliverable], [], decisions, audits, [], minimum_sample=3)
    row = result["projects"][0]
    assert row["acceptance_rate_percent"] == 66.7
    assert row["sample_sufficient"] is True
    assert row["acceptance_cycle_observations"] == 1
    assert result["summary"]["acceptance_cycle_observations"] == 1


def test_small_sample_hides_rate_and_revision_origin_is_not_guessed():
    project = NS(id="p1", title="Website")
    deliverable = NS(id="d1", project_id="p1", title="Landing page")
    revisions = [NS(id="r1", deliverable_id="d1", version=1, revision_origin="initial", created_at=BASE),
                 NS(id="r2", deliverable_id="d1", version=2, revision_origin="unclassified", created_at=BASE + timedelta(days=2)),
                 NS(id="r3", deliverable_id="d1", version=3, revision_origin="unclassified", created_at=BASE + timedelta(days=3))]
    event = NS(id="a1", deliverable_id="d1", revision_version=1, decision="changes_requested", created_at=BASE + timedelta(days=1))
    result = build_delivery_quality([project], [deliverable], revisions, [event], [], [], minimum_sample=3)
    row = result["projects"][0]
    assert row["acceptance_rate_percent"] is None
    drow = result["deliverables"][0]
    assert drow["client_requested_revision_versions"] == 0
    assert drow["unclassified_revision_versions"] == 2
    assert "legacy revisions remain unclassified" in result["limitations"][2]


def test_scope_changes_are_separate_and_other_users_records_are_ignored():
    project = NS(id="p1", title="API")
    other_deliverable = NS(id="d2", project_id="p2", title="Foreign")
    changes = [NS(id="s1", project_id="p1", status="approved", client_accepted=False),
               NS(id="s2", project_id="p1", status="draft", client_accepted=False),
               NS(id="s3", project_id="p2", status="approved", client_accepted=True)]
    result = build_delivery_quality([project], [other_deliverable], [], [], [], changes)
    assert result["projects"][0]["scope_changes"] == {"total": 2, "accepted": 1, "rejected": 0, "pending": 1}
    assert result["summary"]["feedback_decisions"] == 0


def test_missing_handover_does_not_create_acceptance_cycle():
    project = NS(id="p1", title="Docs")
    deliverable = NS(id="d1", project_id="p1", title="Guide")
    event = NS(id="a1", deliverable_id="d1", revision_version=1, decision="accepted", created_at=BASE)
    result = build_delivery_quality([project], [deliverable], [], [event], [], [])
    assert result["deliverables"][0]["acceptance_cycle_days"] == []
    assert result["projects"][0]["median_acceptance_cycle_days"] is None

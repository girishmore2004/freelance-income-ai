from datetime import date, datetime, timezone
from types import SimpleNamespace as NS
from app.services.delivery_health import build_delivery_health


def project(): return NS(id="p1", user_id="u1", title="Client Portal")
def task(**kw):
    values = dict(id="t1", user_id="u1", project_id="p1", status="in_progress", due_date="2026-11-12", planned_finish_date="")
    values.update(kw); return NS(**values)
def deliverable(): return NS(id="d1", user_id="u1", project_id="p1", title="API")
def issue(**kw):
    values = dict(id="i1", user_id="u1", project_id="p1", severity="critical", status="open", due_date="2026-11-12")
    values.update(kw); return NS(**values)
def audit(status="valid", count=3): return {"projects": [{"project_id":"p1", "chain_status":status, "event_count":count}]}
def evidence(**kw):
    values = dict(project_id="p1", matched=2, missing=0, mismatched=0, unclassified=0)
    values.update(kw); return {"projects":[values]}


def build(**overrides):
    values = dict(projects=[project()], tasks=[task()], deliverables=[deliverable()], revisions=[],
        feedback_events=[], issues=[], audit_result=audit(), evidence_coverage=evidence(), scope_changes=[],
        as_of=date(2026, 11, 13))
    values.update(overrides)
    return build_delivery_health(**values)["projects"][0]


def test_critical_unresolved_issue_requires_attention():
    row = build(issues=[issue()])
    assert row["health_status"] == "needs_attention"
    assert row["signals"]["unresolved_high_critical_issues"] == 1


def test_overdue_task_is_watch_not_opaque_numeric_score():
    row = build()
    assert row["health_status"] == "watch"
    assert row["signals"]["overdue_tasks"] == 1


def test_missing_audit_events_prevent_on_track_claim():
    row = build(tasks=[task(due_date="", planned_finish_date="")], audit_result={"projects":[{"project_id":"p1", "chain_status":"valid", "event_count":0}]})
    assert row["health_status"] == "insufficient_data"
    assert any("No delivery audit events" in item for item in row["missing_data"])


def test_audit_integrity_issue_is_needs_attention():
    assert build(audit_result=audit("integrity_issue", 2))["health_status"] == "needs_attention"


def test_rejected_feedback_and_mismatched_evidence_are_attention_signals():
    feedback = NS(id="f1", user_id="u1", deliverable_id="d1", decision="rejected")
    row = build(feedback_events=[feedback], evidence_coverage=evidence(mismatched=1))
    assert row["health_status"] == "needs_attention"
    assert row["signals"]["rejected_decisions"] == 1


def test_scope_change_summary_is_human_review_only_and_reports_missing_fields():
    change = NS(id="s1", user_id="u1", project_id="p1", title="Add dashboard", description="", reason="Client request",
        budget_delta=1000, currency="INR", timeline_delta_days=3, status="draft", request_hash="hash",
        client_accepted=False, client_accepted_at=None, decision_note="", requested_at=datetime(2026,11,10,tzinfo=timezone.utc))
    row = build(scope_changes=[change])
    item = row["change_control"]["requests"][0]
    assert item["readiness"] == "incomplete"
    assert item["missing_fields"] == ["scope description"]
    assert "do not approve scope" in build_delivery_health([project()], [task()], [deliverable()], [], [], [], audit(), evidence(), [change], date(2026,11,13))["limitations"][-1]


def test_health_service_and_route_are_documented_with_handover_snapshot_migration():
    from pathlib import Path
    root = Path(__file__).parents[1]
    main = (root / "app" / "main.py").read_text()
    assert '@app.get("/api/v1/analytics/delivery-health")' in main
    assert 'version="5.45.0"' in main
    assert not (root / "alembic" / "versions" / "0040_delivery_health.py").exists()


def test_empty_event_chain_with_nonempty_head_mismatch_is_not_ignored():
    row = build(tasks=[task(due_date="", planned_finish_date="")],
        audit_result={"projects":[{"project_id":"p1", "chain_status":"integrity_issue", "event_count":0}]})
    assert row["health_status"] == "needs_attention"
    assert row["signals"]["audit_chain_status"] == "integrity_issue"

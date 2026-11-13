from datetime import date, datetime, timezone
from types import SimpleNamespace as Row

from app.services.action_planner import build_action_plan


TODAY = date(2026, 11, 13)


def row(**kwargs):
    return Row(**kwargs)


def test_action_plan_includes_delivery_finance_and_approval_lifecycle():
    result = build_action_plan(
        today=TODAY,
        milestones=[row(id="m1", title="Design review", status="pending", due_date="2026-11-12")],
        deliverables=[row(id="d1", title="Source handover", status="submitted_for_review", due_date="2026-11-20")],
        invoice_schedules=[row(id="s1", title="Final milestone", status="approved", due_date="2026-11-20", invoice_id=None)],
        approvals=[row(id="a1", decision="pending")],
        email_drafts=[row(id="e1", status="pending_approval")],
        marketplace_applications=[row(id="ma1", provider="manual", status="approved", submitted_at=None)],
    )
    refs = {(item["evidence"]["type"], item["evidence"]["id"]) for item in result["actions"]}
    assert {
        ("milestone", "m1"), ("deliverable", "d1"), ("invoice_schedule", "s1"),
        ("approval", "a1"), ("email_draft", "e1"), ("marketplace_application", "ma1"),
    }.issubset(refs)
    assert result["total_actionable_records"] == 6
    assert all(item["requires_human_approval"] for item in result["actions"])


def test_action_plan_excludes_completed_and_sent_records():
    result = build_action_plan(
        today=TODAY,
        milestones=[row(id="m1", title="Done", status="completed", due_date="2026-11-10")],
        deliverables=[row(id="d1", title="Accepted", status="accepted", due_date="2026-11-10")],
        invoice_schedules=[row(id="s1", title="Issued", status="issued", due_date="2026-11-10", invoice_id="i1")],
        email_drafts=[row(id="e1", status="approved_not_sent")],
        marketplace_applications=[row(id="ma1", provider="manual", status="submitted", submitted_at=datetime.now(timezone.utc))],
    )
    assert result["actions"] == []
    assert result["total_actionable_records"] == 0


def test_action_plan_prioritizes_overdue_items_and_respects_limit():
    result = build_action_plan(
        today=TODAY,
        invoices=[
            row(id="i1", invoice_number="INV-1", status="unpaid", due_date="2026-11-01"),
            row(id="i2", invoice_number="INV-2", status="unpaid", due_date="2026-11-13"),
        ],
        limit=1,
    )
    assert result["returned_actions"] == 1
    assert result["actions"][0]["evidence"]["id"] == "i1"
    assert result["actions"][0]["priority"] < 2


def test_action_plan_caps_limit_and_handles_bad_dates():
    result = build_action_plan(
        today=TODAY,
        tasks=[row(id=str(i), title=f"Task {i}", status="todo", due_date="not-a-date") for i in range(60)],
        limit=500,
    )
    assert result["returned_actions"] == 0
    assert result["actions"] == []


def test_action_plan_includes_pending_scope_change_for_client_confirmation():
    result = build_action_plan(
        today=TODAY,
        scope_changes=[row(id="sc1", title="Extra integration", status="pending_approval")],
    )
    assert result["total_actionable_records"] == 1
    action = result["actions"][0]
    assert action["evidence"] == {"type": "scope_change", "id": "sc1"}
    assert "client" in action["reason"].lower()
    assert action["requires_human_approval"] is True

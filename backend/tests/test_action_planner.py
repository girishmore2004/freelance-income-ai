from datetime import date, datetime, timezone
from types import SimpleNamespace
from app.services.action_planner import build_action_plan


def row(**kwargs):
    return SimpleNamespace(**kwargs)


def test_action_plan_prioritizes_overdue_invoice_and_task_and_marks_approval():
    result = build_action_plan(
        invoices=[row(id="i1", invoice_number="INV-1", status="unpaid", due_date="2026-11-01")],
        tasks=[row(id="t1", title="Submit draft", status="todo", due_date="2026-11-12")],
        today=date(2026, 11, 12),
    )
    assert result["returned_actions"] == 2
    assert result["actions"][0]["evidence"] == {"type": "invoice", "id": "i1"}
    assert all(item["requires_human_approval"] for item in result["actions"])


def test_action_plan_ignores_paid_and_completed_records():
    result = build_action_plan(
        invoices=[row(id="i1", invoice_number="INV-1", status="paid", due_date="2026-11-01")],
        tasks=[row(id="t1", title="Done", status="completed", due_date="2026-11-01")],
        today=date(2026, 11, 12),
    )
    assert result["actions"] == []


def test_action_plan_flags_stale_opportunity_and_overdue_project():
    result = build_action_plan(
        opportunities=[row(id="o1", title="Build API", status="new", created_at=datetime(2026, 10, 1, tzinfo=timezone.utc))],
        projects=[row(id="p1", title="Client portal", status="active", due_date="2026-11-10")],
        today=date(2026, 11, 12),
    )
    assert {x["evidence"]["id"] for x in result["actions"]} == {"o1", "p1"}

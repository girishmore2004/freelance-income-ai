from datetime import datetime, timezone
from types import SimpleNamespace
import pytest
from app.services.business_intelligence import build_source_performance


def row(**kwargs):
    return SimpleNamespace(**kwargs)


def test_source_roi_uses_only_project_linked_costs_and_paid_revenue_by_currency():
    opportunities = [row(id="o1", source="upwork"), row(id="o2", source="fiverr")]
    projects = [
        row(id="p1", origin_opportunity_id="o1"),
        row(id="p2", origin_opportunity_id="o2"),
    ]
    invoices = [
        row(project_id="p1", status="paid", amount=1000, currency="INR"),
        row(project_id="p1", status="unpaid", amount=500, currency="INR"),
        row(project_id="p2", status="paid", amount=100, currency="USD"),
    ]
    costs = [
        row(project_id="p1", amount=200, currency="INR"),
        row(project_id="p1", amount=10, currency="USD"),
        row(project_id=None, amount=999, currency="INR"),  # unallocated overhead excluded
        row(project_id="p2", amount=20, currency="USD"),
    ]
    result = build_source_performance(opportunities, [], [], projects, invoices, costs, minimum_sample=2)
    by_source = {x["source"]: x for x in result}
    upwork = by_source["upwork"]
    assert upwork["paid_revenue_by_currency"] == {"INR": 1000.0}
    assert upwork["attributed_project_costs_by_currency"] == {"INR": 200.0, "USD": 10.0}
    assert upwork["roi_by_currency"]["INR"]["roi_percent"] == 400.0
    assert upwork["roi_by_currency"]["USD"]["roi_percent"] is None
    assert upwork["roi_by_currency"]["USD"]["status"] == "insufficient_currency_matched_revenue_and_cost"
    assert by_source["fiverr"]["roi_by_currency"]["USD"]["roi_percent"] == 400.0


def test_source_win_rate_requires_minimum_decided_outcomes_and_unknown_is_separate():
    opportunities = [row(id=f"o{i}", source="upwork") for i in range(5)]
    feedback = [
        row(opportunity_id="o0", outcome="won", created_at=datetime.now(timezone.utc)),
        row(opportunity_id="o1", outcome="lost", created_at=datetime.now(timezone.utc)),
        row(opportunity_id="o2", outcome="no_response", created_at=datetime.now(timezone.utc)),
    ]
    result = build_source_performance(opportunities, [], feedback, minimum_sample=3)
    row_result = result[0]
    assert row_result["wins"] == 1
    assert row_result["losses"] == 1
    assert row_result["unknown_or_undecided"] == 1
    assert row_result["decided_sample_size"] == 2
    assert row_result["win_rate_percent"] is None
    assert row_result["descriptive_win_rate_percent"] == 50.0


def test_source_performance_rejects_too_low_minimum_sample():
    with pytest.raises(ValueError):
        build_source_performance([], [], [], minimum_sample=1)

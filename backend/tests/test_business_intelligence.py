from datetime import date, datetime, timezone
from types import SimpleNamespace
from app.services.business_intelligence import (
    build_funnel, build_source_performance, build_capacity,
    build_project_profitability, build_earnings_outlook,
)


def obj(**kwargs):
    return SimpleNamespace(**kwargs)


def test_funnel_reports_manual_conversion_and_null_rate_without_decisions():
    opps = [obj(id="o1"), obj(id="o2")]
    proposals = [obj(opportunity_id="o1")]
    apps = [obj(opportunity_id="o1", status="submitted")]
    result = build_funnel(opps, proposals, apps, [])
    assert result["opportunities"] == 2
    assert result["recorded_submissions"] == 1
    assert result["win_rate_percent"] is None


def test_source_performance_groups_by_source_and_latest_feedback():
    opps = [obj(id="a", source="rss"), obj(id="b", source="manual")]
    apps = [obj(opportunity_id="a", status="submitted")]
    feedback = [
        obj(opportunity_id="a", outcome="lost", created_at=datetime(2026, 1, 1, tzinfo=timezone.utc)),
        obj(opportunity_id="a", outcome="won", created_at=datetime(2026, 1, 2, tzinfo=timezone.utc)),
    ]
    result = build_source_performance(opps, apps, feedback)
    rss = next(x for x in result if x["source"] == "rss")
    assert rss["wins"] == 1
    assert rss["losses"] == 0
    assert rss["win_rate_percent"] == 100.0


def test_capacity_uses_profile_weekly_target_and_recorded_hours():
    entries = [
        obj(work_date="2026-11-10", duration_minutes=120, billable=True),
        obj(work_date="2026-11-11", duration_minutes=60, billable=False),
        obj(work_date="2026-10-01", duration_minutes=300, billable=True),
    ]
    result = build_capacity(entries, weekly_hours=10, today=date(2026, 11, 12), lookback_days=7)
    assert result["logged_hours"] == 3
    assert result["billable_hours"] == 2
    assert result["capacity_hours_in_period"] == 10


def test_project_profitability_does_not_claim_margin_without_rates():
    projects = [obj(id="p1", title="Site", client_name="Client", currency="INR", budget=10000)]
    invoices = [obj(project_id="p1", currency="INR", amount=5000, status="paid")]
    entries = [obj(project_id="p1", duration_minutes=300, billable=True, hourly_rate=0, currency="INR")]
    row = build_project_profitability(projects, invoices, entries)[0]
    assert row["paid_invoice_revenue"] == 5000
    assert row["margin_after_logged_labor"] is None
    assert row["profitability_status"] == "insufficient_rate_data"


def test_earnings_outlook_hides_weighted_pipeline_with_small_sample():
    opps = [obj(id="o1", currency="INR")]
    proposals = [obj(opportunity_id="o1", proposed_price=20000, currency="INR", status="submitted", created_at=datetime(2026,1,1,tzinfo=timezone.utc))]
    feedback = [obj(opportunity_id="o1", outcome="won", created_at=datetime(2026,1,2,tzinfo=timezone.utc))]
    result = build_earnings_outlook([], [], opps, proposals, feedback, today=date(2026,11,12))
    assert result["by_currency"]["INR"]["open_proposal_value"] == 20000
    assert result["by_currency"]["INR"]["weighted_pipeline_estimate"] is None


def test_source_performance_attributes_only_paid_project_invoices():
    opps = [obj(id="a", source="rss")]
    projects = [obj(id="p1", origin_opportunity_id="a")]
    invoices = [
        obj(project_id="p1", status="paid", amount=1500, currency="INR"),
        obj(project_id="p1", status="unpaid", amount=900, currency="INR"),
    ]
    rows = build_source_performance(opps, [], [], projects, invoices)
    assert rows[0]["paid_revenue_by_currency"] == {"INR": 1500.0}


def test_project_profitability_does_not_assume_zero_cost_without_billable_time():
    projects = [obj(id="p2", title="Design", client_name="Client", currency="INR", budget=5000)]
    invoices = [obj(project_id="p2", currency="INR", amount=5000, status="paid")]
    row = build_project_profitability(projects, invoices, [])[0]
    assert row["margin_after_logged_labor"] is None
    assert row["profitability_status"] == "insufficient_billable_time_data"

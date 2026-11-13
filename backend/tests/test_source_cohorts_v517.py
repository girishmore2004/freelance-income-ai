from datetime import date, datetime, timezone, timedelta
from types import SimpleNamespace
import pytest

from app.services.business_intelligence import build_source_cohort_intelligence


def rec(**kwargs):
    return SimpleNamespace(**kwargs)


def stamp(days_ago):
    return datetime(2026, 11, 13, 12, tzinfo=timezone.utc) - timedelta(days=days_ago)


def test_cohort_tracks_same_opportunity_and_linked_cash_only():
    opportunities = [
        rec(id="lead-a", source="Upwork", created_at=stamp(20)),
        rec(id="lead-b", source="Upwork", created_at=stamp(10)),
        rec(id="old", source="Fiverr", created_at=stamp(200)),
    ]
    proposals = [
        rec(opportunity_id="lead-a", created_at=stamp(18)),
        rec(opportunity_id="old", created_at=stamp(2)),  # excluded: outside 30-day cohort
    ]
    applications = [
        rec(opportunity_id="lead-a", submitted_at=stamp(17), status="submitted"),
        rec(opportunity_id="lead-b", submitted_at=None, status="draft"),
    ]
    feedback = [
        rec(opportunity_id="lead-a", outcome="won", created_at=stamp(15)),
        rec(opportunity_id="lead-b", outcome="no_response", created_at=stamp(5)),
    ]
    projects = [
        rec(id="project-a", origin_opportunity_id="lead-a", created_at=stamp(12)),
        rec(id="unlinked", origin_opportunity_id=None, created_at=stamp(3)),
    ]
    invoices = [rec(id="invoice-a", project_id="project-a", currency="INR")]
    events = [
        rec(invoice_id="invoice-a", event_type="receipt", amount=5000, currency="INR", occurred_at=stamp(8)),
        rec(invoice_id="invoice-a", event_type="refund", amount=500, currency="INR", occurred_at=stamp(4)),
    ]
    result = build_source_cohort_intelligence(
        opportunities, proposals, applications, feedback, projects, invoices, events,
        today=date(2026, 11, 13),
    )
    rows = {x["source"]: x for x in result["windows"]["30"]["sources"]}
    upwork = rows["upwork"]
    assert upwork["cohort_opportunities"] == 2
    assert upwork["with_proposal"] == 1
    assert upwork["submitted"] == 1
    assert upwork["decided_outcomes"] == 1
    assert upwork["wins"] == 1
    assert upwork["projects_created"] == 1
    assert upwork["net_recorded_cash_by_currency"] == {"INR": 4500.0}
    assert upwork["proposal_conversion_percent"] == 50.0
    assert upwork["project_conversion_percent"] == 50.0
    assert "fiverr" not in rows


def test_cohort_ignores_downstream_events_before_opportunity_creation():
    opportunities = [rec(id="lead", source="manual", created_at=stamp(5))]
    proposals = [rec(opportunity_id="lead", created_at=stamp(8))]
    applications = [rec(opportunity_id="lead", submitted_at=stamp(9), status="submitted")]
    feedback = [rec(opportunity_id="lead", outcome="won", created_at=stamp(7))]
    result = build_source_cohort_intelligence(
        opportunities, proposals, applications, feedback, today=date(2026, 11, 13)
    )
    row = result["windows"]["30"]["sources"][0]
    assert row["with_proposal"] == 0
    assert row["submitted"] == 0
    assert row["decided_outcomes"] == 0


def test_cohort_uses_latest_feedback_and_validates_window():
    opportunities = [rec(id="lead", source="manual", created_at=stamp(5))]
    feedback = [
        rec(opportunity_id="lead", outcome="won", created_at=stamp(4)),
        rec(opportunity_id="lead", outcome="no_response", created_at=stamp(3)),
    ]
    result = build_source_cohort_intelligence(
        opportunities, [], [], feedback, today=date(2026, 11, 13)
    )
    row = result["windows"]["30"]["sources"][0]
    assert row["decided_outcomes"] == 0
    assert row["win_rate_of_decided_percent"] is None
    with pytest.raises(ValueError):
        build_source_cohort_intelligence([], [], [], [], windows=(731,), today=date(2026, 11, 13))

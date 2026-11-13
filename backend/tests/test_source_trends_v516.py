from datetime import date, datetime, timezone, timedelta
from types import SimpleNamespace
import pytest
from app.services.business_intelligence import build_time_windowed_source_intelligence


def r(**kwargs):
    return SimpleNamespace(**kwargs)


def dt(days_ago):
    return datetime(2026, 11, 13, 12, 0, tzinfo=timezone.utc) - timedelta(days=days_ago)


def test_source_trends_use_each_events_timestamp_and_only_linked_payment_events():
    opportunities = [
        r(id="old", source="upwork", created_at=dt(200)),
        r(id="recent", source="fiverr", created_at=dt(12)),
    ]
    proposals = [
        r(opportunity_id="old", created_at=dt(20)),  # valid period activity on an older lead
        r(opportunity_id="recent", created_at=dt(8)),
    ]
    applications = [r(opportunity_id="recent", submitted_at=dt(7))]
    feedback = [
        r(opportunity_id="recent", outcome="won", created_at=dt(6)),
        r(opportunity_id="recent", outcome="no_response", created_at=dt(5)),
    ]
    projects = [r(id="p1", origin_opportunity_id="recent"), r(id="unlinked", origin_opportunity_id=None)]
    invoices = [r(id="i1", project_id="p1", currency="INR"), r(id="i2", project_id="unlinked", currency="INR")]
    events = [
        r(invoice_id="i1", event_type="receipt", amount=1000, currency="INR", occurred_at=dt(4)),
        r(invoice_id="i1", event_type="refund", amount=100, currency="INR", occurred_at=dt(3)),
        r(invoice_id="i2", event_type="receipt", amount=9000, currency="INR", occurred_at=dt(2)),
        r(invoice_id="i1", event_type="receipt", amount=500, currency="INR", occurred_at=dt(50)),
    ]
    result = build_time_windowed_source_intelligence(
        opportunities, proposals, applications, feedback, projects, invoices, events,
        today=date(2026, 11, 13),
    )
    rows = {x["source"]: x for x in result["windows"]["30"]["sources"]}
    assert rows["fiverr"]["opportunities_added"] == 1
    assert rows["fiverr"]["proposals_created"] == 1
    assert rows["fiverr"]["submitted_applications"] == 1
    assert rows["fiverr"]["wins_recorded"] == 1
    assert rows["fiverr"]["unknown_outcomes_recorded"] == 1
    assert rows["fiverr"]["recorded_win_rate_percent"] == 100.0
    assert rows["fiverr"]["net_recorded_receipts_by_currency"] == {"INR": 900.0}
    assert rows["upwork"]["opportunities_added"] == 0
    assert rows["upwork"]["proposals_created"] == 1
    assert rows["fiverr"]["net_recorded_receipts_by_currency"] != {"INR": 9900.0}
    assert "180" in result["windows"]


def test_source_trends_exclude_missing_timestamps_and_validate_windows():
    result = build_time_windowed_source_intelligence(
        [r(id="o1", source="manual", created_at=None)], [], [], [], today=date(2026, 11, 13)
    )
    assert result["windows"]["30"]["sources"] == []
    with pytest.raises(ValueError):
        build_time_windowed_source_intelligence([], [], [], [], windows=(0,), today=date(2026, 11, 13))

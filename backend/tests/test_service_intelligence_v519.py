from datetime import datetime, timezone, timedelta
from types import SimpleNamespace as NS
from app.services.service_intelligence import build_service_intelligence

BASE = datetime(2026, 1, 1, tzinfo=timezone.utc)

def row(**kwargs):
    return NS(**kwargs)


def test_category_classification_and_time_to_milestones():
    opp = row(id="o1", industry="", title="Build RAG AI Copilot", description="knowledge base chatbot",
              required_skills='["Python"]', created_at=BASE)
    proposal = row(opportunity_id="o1", created_at=BASE + timedelta(days=2))
    app = row(opportunity_id="o1", status="submitted", submitted_at=BASE + timedelta(days=4))
    feedback = row(opportunity_id="o1", outcome="won", created_at=BASE + timedelta(days=10))
    project = row(id="p1", origin_opportunity_id="o1", created_at=BASE + timedelta(days=12))
    result = build_service_intelligence([opp], [proposal], [app], [feedback], [project])
    item = result["categories"][0]
    assert item["service_category"] == "ai_rag_copilot"
    assert item["classification_methods"] == {"keyword_inferred": 1}
    assert item["median_days_to_proposal"] == 2
    assert item["median_days_to_submission"] == 4
    assert item["median_days_to_win"] == 10
    assert item["median_days_to_project"] == 12


def test_explicit_industry_overrides_keywords_and_cash_costs_are_currency_separated():
    opp = row(id="o1", industry="Manufacturing", title="RAG AI Copilot", description="",
              required_skills="[]", created_at=BASE)
    project = row(id="p1", origin_opportunity_id="o1", created_at=BASE + timedelta(days=1))
    invoice = row(id="i1", project_id="p1", currency="INR")
    receipt = row(invoice_id="i1", event_type="receipt", amount=10000, currency="INR",
                  occurred_at=BASE + timedelta(days=20))
    refund = row(invoice_id="i1", event_type="refund", amount=1000, currency="INR",
                 occurred_at=BASE + timedelta(days=22))
    cost = row(project_id="p1", amount=2000, currency="INR")
    time = row(project_id="p1", billable=True, duration_minutes=120, hourly_rate=500, currency="INR")
    result = build_service_intelligence([opp], [], [], [], [project], [invoice], [receipt, refund], [cost], [time])
    item = result["categories"][0]
    assert item["service_category"] == "industry:manufacturing"
    assert item["classification_methods"] == {"explicit_industry": 1}
    assert item["median_days_to_first_receipt"] == 20
    economics = item["economics_by_currency"]["INR"]
    assert economics["net_recorded_cash"] == 9000
    assert economics["recorded_direct_project_cost"] == 2000
    assert economics["estimated_billable_labor_cost"] == 1000
    assert economics["estimated_contribution_after_recorded_costs"] == 6000


def test_missing_cost_data_withholds_contribution_and_excludes_unlinked_events():
    opp = row(id="o1", industry="", title="Unknown work", description="miscellaneous",
              required_skills="[]", created_at=BASE)
    project = row(id="p1", origin_opportunity_id="o1", created_at=BASE)
    invoice = row(id="i1", project_id=None, currency="USD")
    receipt = row(invoice_id="i1", event_type="receipt", amount=500, currency="USD", occurred_at=BASE)
    result = build_service_intelligence([opp], [], [], [], [project], [invoice], [receipt])
    item = result["categories"][0]
    assert item["service_category"] == "other_or_unclassified"
    assert item["economics_by_currency"] == {}

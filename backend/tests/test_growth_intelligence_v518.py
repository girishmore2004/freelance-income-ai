from app.services.growth_intelligence import build_growth_recommendations


def test_low_sample_gets_data_collection_not_ranked():
    report = {"as_of": "2026-11-13", "windows": {"180": {"window_days": 180, "sources": [
        {"source": "fiverr", "cohort_opportunities": 2, "with_proposal": 1,
         "submitted": 1, "decided_outcomes": 1, "wins": 1,
         "win_rate_of_decided_percent": 100.0}
    ]}}}
    result = build_growth_recommendations(report)
    assert result["recommendations"][0]["priority"] == "collect_more_data"
    assert result["tested_sources"] == []


def test_good_decided_sample_can_be_tested_but_not_guaranteed():
    report = {"windows": {"180": {"window_days": 180, "sources": [
        {"source": "upwork", "cohort_opportunities": 12, "with_proposal": 10,
         "submitted": 9, "decided_outcomes": 6, "wins": 3,
         "win_rate_of_decided_percent": 50.0, "proposal_conversion_percent": 83.3,
         "submission_conversion_percent": 75.0, "net_recorded_cash_by_currency": {"INR": 12000}}
    ]}}}
    result = build_growth_recommendations(report)
    assert result["tested_sources"][0]["source"] == "upwork"
    assert result["recommendations"][0]["priority"] == "prioritize_tested_source"
    assert "controlled test" in result["recommendations"][0]["action"]


def test_low_win_rate_triggers_fit_review():
    report = {"windows": {"180": {"sources": [
        {"source": "contra", "cohort_opportunities": 8, "with_proposal": 7,
         "submitted": 6, "decided_outcomes": 5, "wins": 0,
         "win_rate_of_decided_percent": 0.0, "proposal_conversion_percent": 87.5,
         "submission_conversion_percent": 75.0}
    ]}}}
    result = build_growth_recommendations(report)
    assert any(x["priority"] == "review_source_fit" for x in result["recommendations"])

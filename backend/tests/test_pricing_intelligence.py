from app.services.pricing_intelligence import recommend_price, profitability, outcome_segments


def test_price_recommendation_uses_profile_baseline_and_minimum():
    result=recommend_price({"id":"o1","estimated_hours":10,"currency":"INR"},
                           {"hourly_rate":1000,"minimum_budget":5000,"currency":"INR"},[])
    assert result["recommended_price"]==10000
    assert result["range_low"]==9000
    assert result["range_high"]==11000
    assert result["requires_user_review"] is True
    assert result["confidence"]=="low"


def test_price_recommendation_calibrates_only_after_three_wins_and_bounds_outliers():
    opportunity={"id":"o2","estimated_hours":10,"currency":"INR"}
    profile={"hourly_rate":1000,"minimum_budget":5000}
    few=[{"price":15000},{"price":15000}]
    assert recommend_price(opportunity,profile,few)["recommended_price"]==10000
    enough=[{"price":15000},{"price":15000},{"price":15000}]
    result=recommend_price(opportunity,profile,enough)
    assert result["recommended_price"]==11500
    assert result["historical_samples"]==3


def test_price_recommendation_returns_insufficient_data_when_no_budget_or_rate():
    result=recommend_price({"id":"o3","currency":"INR"},{},[])
    assert result["recommended_price"] is None
    assert result["confidence"]=="insufficient_data"


def test_profitability_counts_paid_revenue_and_reports_time_value_proxy():
    result=profitability({"id":"p1","budget":20000,"currency":"INR"},
        [{"duration_minutes":120,"hourly_rate":1000,"billable":True},
         {"duration_minutes":60,"hourly_rate":500,"billable":False}],
        [{"amount":10000,"status":"paid"},{"amount":5000,"status":"unpaid"}])
    assert result["paid_revenue"]==10000
    assert result["non_cancelled_invoiced"]==15000
    assert result["tracked_hours"]==3
    assert result["internal_time_value_proxy"]==2500
    assert result["realized_paid_revenue_per_hour"]==round(10000/3,2)


def test_outcome_segments_group_relative_price_bands():
    rows=[
      {"industry":"software","job_type":"fixed","currency":"INR","budget_max":10000,"price":7000,"outcome":"won"},
      {"industry":"software","job_type":"fixed","currency":"INR","budget_max":10000,"price":9000,"outcome":"lost"},
      {"industry":"software","job_type":"fixed","currency":"INR","budget_max":10000,"price":12000,"outcome":"won"},
    ]
    result=outcome_segments(rows)
    assert len(result)==3
    assert {x["price_band"] for x in result}=={"at_or_below_80_percent","80_to_100_percent","above_listing_budget"}

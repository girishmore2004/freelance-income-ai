from app.services.client_business_intelligence import (
    aggregate_client_financials, calculate_client_health,
)


def test_profitability_separates_currencies_and_counts_direct_and_labor_costs():
    result = aggregate_client_financials(
        "client-1", 2,
        [{"amount": 1000, "currency": "INR", "net_paid": 700, "outstanding": 300},
         {"amount": 100, "currency": "USD", "net_paid": 100, "outstanding": 0}],
        [{"duration_minutes": 120, "hourly_rate": 200, "currency": "INR"}],
        [{"amount": 100, "currency": "INR"}, {"amount": 20, "currency": "USD"}],
    )
    assert result["by_currency"]["INR"]["total_recorded_cost"] == 500
    assert result["by_currency"]["INR"]["cash_contribution_estimate"] == 200
    assert result["by_currency"]["INR"]["outstanding"] == 300
    assert result["by_currency"]["USD"]["cash_contribution_estimate"] == 80
    assert result["hours_recorded"] == 2
    assert result["direct_cost_entries"] == 2


def test_no_currency_conversion_or_cross_currency_sum():
    result = aggregate_client_financials(
        "client-2", 1,
        [{"amount": 100, "currency": "INR", "net_paid": 100, "outstanding": 0}],
        [{"duration_minutes": 60, "hourly_rate": 10, "currency": "USD"}],
        [],
    )
    assert set(result["by_currency"]) == {"INR", "USD"}
    assert result["by_currency"]["INR"]["cash_contribution_estimate"] == 100
    assert result["by_currency"]["USD"]["cash_contribution_estimate"] == -10


def test_health_score_explains_overdue_and_stale_contact_factors():
    result = calculate_client_health(
        project_count=3, invoice_count=4, open_balance_count=2, overdue_count=1,
        average_days_late=10, days_since_contact=90, communication_count=2,
        client_status="active",
    )
    assert result["score"] < 80
    assert result["label"] in {"watch", "at_risk"}
    assert {x["factor"] for x in result["factors"]} == {
        "overdue_invoices", "open_balances", "payment_delay", "contact_recency"
    }


def test_health_with_no_history_is_not_misrepresented_as_healthy():
    result = calculate_client_health(
        project_count=0, invoice_count=0, open_balance_count=0, overdue_count=0,
        average_days_late=None, days_since_contact=None, communication_count=0,
        client_status="active",
    )
    assert result["label"] == "insufficient_history"
    assert result["score"] == 100
    assert "credit score" in result["warning"].lower()


def test_health_penalizes_archived_client_and_bounds_score():
    result = calculate_client_health(
        project_count=1, invoice_count=1, open_balance_count=1, overdue_count=20,
        average_days_late=1000, days_since_contact=500, communication_count=0,
        client_status="archived",
    )
    assert result["score"] == 5
    assert result["label"] == "at_risk"

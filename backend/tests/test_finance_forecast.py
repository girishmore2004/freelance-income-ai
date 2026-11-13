from datetime import date
from types import SimpleNamespace
from app.services.finance_forecast import build_cashflow_forecast


def test_cashflow_rollup_separates_paid_overdue_and_scheduled():
    today = date(2026, 11, 12)
    invoices = [
        SimpleNamespace(currency="INR", amount=1000, status="paid", due_date="2026-11-01"),
        SimpleNamespace(currency="INR", amount=2000, status="unpaid", due_date="2026-11-01"),
        SimpleNamespace(currency="INR", amount=3000, status="unpaid", due_date="2026-11-20"),
        SimpleNamespace(currency="INR", amount=9000, status="cancelled", due_date="2026-11-15"),
    ]
    schedules = [
        SimpleNamespace(currency="INR", amount=4000, status="approved", due_date="2026-12-01", invoice_id=None),
        SimpleNamespace(currency="INR", amount=5000, status="invoiced", due_date="2026-12-02", invoice_id="inv"),
    ]
    result = build_cashflow_forecast(invoices, schedules, today=today, horizon_days=90)
    values = result["by_currency"]["INR"]
    assert values["paid_recorded"] == 1000
    assert values["overdue_receivables"] == 2000
    assert values["invoice_due_within_horizon"] == 3000
    assert values["approved_or_planned_schedule_not_invoiced"] == 4000


def test_forecast_ignores_invalid_dates_and_out_of_horizon():
    invoices = [SimpleNamespace(currency="USD", amount=20, status="unpaid", due_date="bad")]
    schedules = [SimpleNamespace(currency="USD", amount=50, status="planned", due_date="2028-01-01", invoice_id=None)]
    result = build_cashflow_forecast(invoices, schedules, today=date(2026, 11, 12), horizon_days=30)
    assert result["by_currency"] == {}

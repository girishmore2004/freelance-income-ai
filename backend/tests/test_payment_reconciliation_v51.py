from types import SimpleNamespace
import pytest

from app.services.payment_reconciliation import (
    validate_payment_event, summarize_events, aggregate_by_currency,
)


def event(kind, amount=0, when=1):
    return SimpleNamespace(event_type=kind, amount=amount, occurred_at=when, created_at=when, id=str(when))


def test_receipt_and_refund_calculate_net_paid_and_outstanding():
    rows = [event("receipt", 7000), event("receipt", 3000, 2), event("refund", 1500, 3)]
    result = summarize_events(rows, 12000)
    assert result["received"] == 10000
    assert result["refunded"] == 1500
    assert result["net_paid"] == 8500
    assert result["outstanding"] == 3500
    assert result["status"] == "partially_paid"


def test_full_payment_and_overpayment_do_not_create_negative_outstanding():
    result = summarize_events([event("receipt", 12000)], 10000)
    assert result["status"] == "paid"
    assert result["outstanding"] == 0
    assert result["net_paid"] == 12000


def test_refunds_can_reduce_payment_to_zero():
    result = summarize_events([event("receipt", 1000), event("refund", 1000, 2)], 1000)
    assert result["net_paid"] == 0
    assert result["status"] == "unpaid"


def test_dispute_open_and_resolution_are_counted_in_event_order():
    result = summarize_events([
        event("dispute_opened", 0, 1), event("dispute_resolved", 0, 2),
        event("dispute_opened", 0, 3),
    ], 100)
    assert result["open_disputes"] == 1


@pytest.mark.parametrize("kind,amount,currency,invoice_currency,evidence", [
    ("receipt", 10, "INR", "INR", "bank ref 123"),
    ("refund", 1, "INR", "INR", "refund ref 1"),
    ("dispute_opened", 0, "USD", "USD", "case reference"),
])
def test_valid_events(kind, amount, currency, invoice_currency, evidence):
    assert validate_payment_event(kind, amount, currency, invoice_currency, evidence) == (kind, currency)


@pytest.mark.parametrize("args,message", [
    (("receipt", 0, "INR", "INR", "evidence 123"), "greater than zero"),
    (("refund", 1, "USD", "INR", "evidence 123"), "must match"),
    (("wire_transfer", 10, "INR", "INR", "evidence 123"), "Unsupported"),
    (("dispute_opened", 10, "INR", "INR", "evidence 123"), "amount of zero"),
    (("receipt", 1, "INR", "INR", "short"), "at least 8"),
])
def test_invalid_events_are_rejected(args, message):
    with pytest.raises(ValueError, match=message):
        validate_payment_event(*args)


def test_currency_aggregation_never_converts_or_combines():
    assert aggregate_by_currency([
        {"currency": "INR", "amount": 100},
        {"currency": "USD", "amount": 20},
        {"currency": "INR", "amount": 50},
    ]) == {"INR": 150, "USD": 20}


def test_cashflow_forecast_uses_partial_invoice_balance_and_net_receipt():
    from datetime import date
    from types import SimpleNamespace
    from app.services.finance_forecast import build_cashflow_forecast
    invoice = SimpleNamespace(
        status="unpaid", amount=4000, net_paid=6000,
        currency="INR", due_date="2026-11-20",
    )
    result = build_cashflow_forecast([invoice], [], today=date(2026, 11, 13), horizon_days=30)
    assert result["by_currency"]["INR"]["paid_recorded"] == 6000
    assert result["by_currency"]["INR"]["invoice_due_within_horizon"] == 4000

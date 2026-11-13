"""Deterministic cash-flow summaries; not accounting or tax advice."""
from datetime import date, timedelta


def build_cashflow_forecast(invoices, schedules, today=None, horizon_days=90):
    today = today or date.today()
    horizon = today + timedelta(days=horizon_days)
    currency_totals = {}
    overdue = {}
    expected = {}
    scheduled = {}
    paid = {}
    for invoice in invoices:
        if invoice.status == "cancelled":
            continue
        currency = invoice.currency or "INR"
        amount = float(invoice.amount or 0)
        net_paid = getattr(invoice, "net_paid", None)
        if net_paid is not None:
            paid[currency] = paid.get(currency, 0.0) + float(net_paid or 0)
        elif invoice.status == "paid":
            paid[currency] = paid.get(currency, 0.0) + amount
        if invoice.status == "paid" or amount <= 0:
            continue
        due = _parse_date(invoice.due_date)
        if due and due < today:
            overdue[currency] = overdue.get(currency, 0.0) + amount
        if due and today <= due <= horizon:
            expected[currency] = expected.get(currency, 0.0) + amount
    for item in schedules:
        if item.status not in ("approved", "planned"):
            continue
        currency = item.currency or "INR"
        due = _parse_date(item.due_date)
        if due and today <= due <= horizon and not item.invoice_id:
            scheduled[currency] = scheduled.get(currency, 0.0) + float(item.amount or 0)
    currencies = sorted(set(paid) | set(overdue) | set(expected) | set(scheduled))
    return {
        "as_of": today.isoformat(),
        "horizon_days": horizon_days,
        "method": "deterministic_due_date_rollup",
        "disclaimer": "Forecast uses recorded invoices and schedules only; it is not a prediction of client payment behavior.",
        "by_currency": {
            c: {
                "paid_recorded": round(paid.get(c, 0.0), 2),
                "overdue_receivables": round(overdue.get(c, 0.0), 2),
                "invoice_due_within_horizon": round(expected.get(c, 0.0), 2),
                "approved_or_planned_schedule_not_invoiced": round(scheduled.get(c, 0.0), 2),
            } for c in currencies
        },
    }


def _parse_date(value):
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None

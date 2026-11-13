"""Deterministic, currency-isolated invoice payment ledger policy."""
from collections import defaultdict

EVENT_TYPES = {"receipt", "refund", "dispute_opened", "dispute_resolved"}


def validate_payment_event(event_type, amount, currency, invoice_currency, evidence_reference):
    kind = (event_type or "").strip().lower()
    cur = (currency or "").strip().upper()
    inv_cur = (invoice_currency or "").strip().upper()
    if kind not in EVENT_TYPES:
        raise ValueError("Unsupported payment event type")
    if not cur or cur != inv_cur:
        raise ValueError("Payment currency must match the invoice currency; FX conversion is not supported")
    if kind in {"receipt", "refund"} and float(amount or 0) <= 0:
        raise ValueError("Receipt and refund amounts must be greater than zero")
    if kind in {"dispute_opened", "dispute_resolved"} and float(amount or 0) != 0:
        raise ValueError("Dispute events must have an amount of zero")
    if len((evidence_reference or "").strip()) < 8:
        raise ValueError("Evidence reference must contain at least 8 characters")
    return kind, cur


def summarize_events(events, invoice_amount):
    received = sum(float(e.amount or 0) for e in events if e.event_type == "receipt")
    refunded = sum(float(e.amount or 0) for e in events if e.event_type == "refund")
    net_paid = max(0.0, received - refunded)
    outstanding = max(0.0, float(invoice_amount or 0) - net_paid)
    open_disputes = 0
    for event in sorted(events, key=lambda x: (x.occurred_at, x.created_at, x.id)):
        if event.event_type == "dispute_opened":
            open_disputes += 1
        elif event.event_type == "dispute_resolved":
            open_disputes = max(0, open_disputes - 1)
    return {
        "received": round(received, 2),
        "refunded": round(refunded, 2),
        "net_paid": round(net_paid, 2),
        "outstanding": round(outstanding, 2),
        "status": "paid" if outstanding <= 0 else ("partially_paid" if net_paid > 0 else "unpaid"),
        "open_disputes": open_disputes,
    }


def aggregate_by_currency(rows):
    """Sum {currency, amount} rows without ever converting or combining currencies."""
    result = defaultdict(float)
    for row in rows:
        result[str(row["currency"]).upper()] += float(row["amount"] or 0)
    return {currency: round(amount, 2) for currency, amount in sorted(result.items())}

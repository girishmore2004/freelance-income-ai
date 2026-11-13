"""Explainable client profitability and relationship-health calculations."""
from collections import defaultdict


def aggregate_client_financials(client_id, project_count, invoices, time_entries, direct_costs):
    invoiced = defaultdict(float)
    received = defaultdict(float)
    outstanding = defaultdict(float)
    labor_cost = defaultdict(float)
    direct = defaultdict(float)
    hours = 0.0

    for row in invoices:
        currency = str(row.get("currency") or "INR").upper()
        invoiced[currency] += float(row.get("amount") or 0)
        received[currency] += float(row.get("net_paid") or 0)
        outstanding[currency] += float(row.get("outstanding") or 0)

    for row in time_entries:
        currency = str(row.get("currency") or "INR").upper()
        entry_hours = max(0.0, float(row.get("duration_minutes") or 0) / 60.0)
        hours += entry_hours
        labor_cost[currency] += entry_hours * max(0.0, float(row.get("hourly_rate") or 0))

    for row in direct_costs:
        currency = str(row.get("currency") or "INR").upper()
        direct[currency] += max(0.0, float(row.get("amount") or 0))

    currencies = sorted(set(invoiced) | set(received) | set(outstanding) | set(labor_cost) | set(direct))
    by_currency = {}
    for currency in currencies:
        total_cost = labor_cost[currency] + direct[currency]
        contribution = received[currency] - total_cost
        by_currency[currency] = {
            "invoiced": round(invoiced[currency], 2),
            "net_received": round(received[currency], 2),
            "outstanding": round(outstanding[currency], 2),
            "labor_cost_estimate": round(labor_cost[currency], 2),
            "direct_costs": round(direct[currency], 2),
            "total_recorded_cost": round(total_cost, 2),
            "cash_contribution_estimate": round(contribution, 2),
            "cash_margin_percent": round(contribution / received[currency] * 100, 1) if received[currency] else None,
        }

    return {
        "client_id": client_id,
        "project_count": project_count,
        "hours_recorded": round(hours, 2),
        "by_currency": by_currency,
        "direct_cost_entries": len(direct_costs),
        "invoice_count": len(invoices),
        "time_entry_count": len(time_entries),
        "method": "recorded_cash_receipts_less_recorded_labor_proxy_and_direct_costs",
        "limitations": [
            "Time-entry hourly rates are treated as labor-cost proxies, not verified payroll costs.",
            "Direct costs include only manually entered cost records.",
            "Unrecorded expenses, taxes, platform fees, unpaid work and overhead are excluded.",
            "Currencies are kept separate and are never converted or combined.",
            "Cash contribution is not accounting profit or tax advice.",
        ],
    }


def calculate_client_health(project_count, invoice_count, open_balance_count, overdue_count,
                            average_days_late, days_since_contact, communication_count,
                            client_status="active"):
    """Transparent 0-100 heuristic with visible component scores and no hidden model."""
    score = 100
    factors = []

    if client_status.lower() in {"inactive", "archived", "blocked"}:
        score -= 25
        factors.append({"factor": "client_status", "impact": -25, "reason": f"Client status is {client_status}."})

    if overdue_count:
        impact = min(35, overdue_count * 12)
        score -= impact
        factors.append({"factor": "overdue_invoices", "impact": -impact,
                        "reason": f"{overdue_count} invoice balance(s) are past their due date."})

    if open_balance_count > overdue_count:
        impact = min(15, (open_balance_count - overdue_count) * 4)
        score -= impact
        factors.append({"factor": "open_balances", "impact": -impact,
                        "reason": f"{open_balance_count - overdue_count} other invoice balance(s) remain open."})

    if average_days_late is not None and average_days_late > 0:
        impact = min(20, round(float(average_days_late) * 0.8, 1))
        score -= impact
        factors.append({"factor": "payment_delay", "impact": -impact,
                        "reason": f"Recorded first receipts averaged {average_days_late:.1f} days after due date."})

    if days_since_contact is not None and days_since_contact > 45:
        impact = min(15, 5 + (days_since_contact - 45) // 30 * 3)
        score -= impact
        factors.append({"factor": "contact_recency", "impact": -impact,
                        "reason": f"No recorded client contact for {days_since_contact} days."})

    if invoice_count == 0 and project_count == 0:
        factors.append({"factor": "limited_history", "impact": 0,
                        "reason": "There is not enough project or invoice history to assess payment behavior."})

    score = max(0, min(100, round(score)))
    if invoice_count == 0 and project_count == 0:
        label = "insufficient_history"
    elif score >= 80:
        label = "healthy"
    elif score >= 60:
        label = "watch"
    else:
        label = "at_risk"

    return {
        "score": score,
        "label": label,
        "factors": factors,
        "inputs": {
            "project_count": project_count,
            "invoice_count": invoice_count,
            "open_balance_count": open_balance_count,
            "overdue_count": overdue_count,
            "average_days_late": round(float(average_days_late), 1) if average_days_late is not None else None,
            "days_since_contact": days_since_contact,
            "communication_count": communication_count,
        },
        "method": "transparent_rule_based_heuristic_v1",
        "warning": "Not a credit score, probability of default, or AI prediction. Missing records are not treated as positive evidence.",
    }

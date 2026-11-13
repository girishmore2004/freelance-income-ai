"""Deterministic approval fingerprint and safe scope-change application rules."""
import hashlib
import json
import hmac
from datetime import date, timedelta


def scope_change_fingerprint(*, project_id, title, description, reason, budget_delta, currency, timeline_delta_days):
    payload = {
        "project_id": str(project_id),
        "title": str(title),
        "description": str(description),
        "reason": str(reason or ""),
        "budget_delta": float(budget_delta or 0),
        "currency": str(currency or "INR").upper(),
        "timeline_delta_days": int(timeline_delta_days or 0),
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def is_current_scope_change(*, stored_hash, supplied_hash, project_id, title, description, reason, budget_delta, currency, timeline_delta_days):
    current_hash = scope_change_fingerprint(
        project_id=project_id, title=title, description=description, reason=reason,
        budget_delta=budget_delta, currency=currency, timeline_delta_days=timeline_delta_days,
    )
    return bool(stored_hash and supplied_hash and hmac.compare_digest(stored_hash, supplied_hash) and hmac.compare_digest(stored_hash, current_hash))


def calculate_approved_scope(*, current_budget, current_due_date, budget_delta, timeline_delta_days):
    new_budget = float(current_budget or 0) + float(budget_delta or 0)
    if new_budget < 0:
        raise ValueError("Approved change would make the project budget negative")
    new_due_date = current_due_date or ""
    days = int(timeline_delta_days or 0)
    if days:
        try:
            current_date = date.fromisoformat(str(current_due_date)[:10])
        except (TypeError, ValueError):
            raise ValueError("Project needs a valid ISO due date before applying a timeline change")
        new_due_date = (current_date + timedelta(days=days)).isoformat()
    return round(new_budget, 2), new_due_date

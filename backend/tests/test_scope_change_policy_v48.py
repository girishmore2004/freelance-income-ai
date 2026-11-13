from datetime import date
import pytest

from app.services.scope_change_policy import (
    calculate_approved_scope, is_current_scope_change, scope_change_fingerprint,
)


def values(**overrides):
    data = {
        "project_id": "project-1", "title": "Additional dashboard",
        "description": "Add a new analytics dashboard and export flow",
        "reason": "Client requested an additional reporting view",
        "budget_delta": 15000, "currency": "INR", "timeline_delta_days": 7,
    }
    data.update(overrides)
    return data


def test_fingerprint_is_stable_and_detects_content_change():
    payload = values()
    fingerprint = scope_change_fingerprint(**payload)
    assert len(fingerprint) == 64
    assert is_current_scope_change(stored_hash=fingerprint, supplied_hash=fingerprint, **payload)
    changed = {**payload, "budget_delta": 18000}
    assert not is_current_scope_change(stored_hash=fingerprint, supplied_hash=fingerprint, **changed)


def test_approved_scope_applies_budget_and_timeline_delta():
    budget, due = calculate_approved_scope(
        current_budget=50000, current_due_date="2026-11-20",
        budget_delta=12000, timeline_delta_days=5,
    )
    assert budget == 62000
    assert due == "2026-11-25"


def test_scope_change_cannot_make_budget_negative():
    with pytest.raises(ValueError, match="negative"):
        calculate_approved_scope(
            current_budget=10000, current_due_date="2026-11-20",
            budget_delta=-12000, timeline_delta_days=0,
        )


def test_timeline_change_requires_valid_project_due_date():
    with pytest.raises(ValueError, match="valid ISO due date"):
        calculate_approved_scope(
            current_budget=10000, current_due_date="TBD",
            budget_delta=0, timeline_delta_days=3,
        )


def test_zero_timeline_delta_does_not_require_due_date():
    budget, due = calculate_approved_scope(
        current_budget=10000, current_due_date="TBD",
        budget_delta=2000, timeline_delta_days=0,
    )
    assert budget == 12000
    assert due == "TBD"


def test_currency_normalization_is_part_of_approval_fingerprint():
    a = scope_change_fingerprint(**values(currency="inr"))
    b = scope_change_fingerprint(**values(currency="INR"))
    assert a == b


def test_timeline_can_be_reduced_without_negative_budget():
    budget, due = calculate_approved_scope(
        current_budget=40000, current_due_date="2026-12-01",
        budget_delta=0, timeline_delta_days=-3,
    )
    assert budget == 40000
    assert due == "2026-11-28"

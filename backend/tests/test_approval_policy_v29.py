from app.services.approval_policy import can_decide_approval, is_current_approval


def test_only_exact_approved_content_is_current():
    assert is_current_approval("approved", "abc123", "abc123")
    assert not is_current_approval("pending", "abc123", "abc123")
    assert not is_current_approval("approved", "old-hash", "new-hash")
    assert not is_current_approval("approved", "", "new-hash")


def test_approval_decision_requires_pending_and_unchanged_content():
    assert can_decide_approval("pending", "same", "same") == (True, "")
    allowed, reason = can_decide_approval("approved", "same", "same")
    assert not allowed and "already decided" in reason
    allowed, reason = can_decide_approval("pending", "old", "new")
    assert not allowed and "changed" in reason


def test_approval_gate_does_not_allow_rejected_or_superseded_content():
    for state in ("rejected", "superseded", "pending", "expired"):
        assert not is_current_approval(state, "same", "same")

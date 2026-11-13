from app.services.client_contract_policy import contract_content_hash, can_transition_contract


def test_contract_hash_is_stable_and_changes_with_content():
    assert contract_content_hash("SOW v1") == contract_content_hash("SOW v1")
    assert contract_content_hash("SOW v1") != contract_content_hash("SOW v2")
    assert len(contract_content_hash("SOW v1")) == 64


def test_contract_lifecycle_requires_manual_sent_before_acceptance():
    assert can_transition_contract("draft", "sent")
    assert can_transition_contract("sent", "accepted")
    assert can_transition_contract("sent", "rejected")
    assert can_transition_contract("sent", "expired")
    assert can_transition_contract("draft", "archived")
    assert not can_transition_contract("draft", "accepted")
    assert not can_transition_contract("accepted", "sent")
    assert not can_transition_contract("rejected", "accepted")

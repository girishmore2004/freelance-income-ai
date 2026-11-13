from types import SimpleNamespace
from app.services.client_contract_policy import contract_content_hash, verify_revision_chain


def test_contract_revision_chain_valid():
    first = contract_content_hash("first contract")
    second = contract_content_hash("second contract")
    rows = [
        SimpleNamespace(version=1, content_hash=first, previous_hash="", content="first contract"),
        SimpleNamespace(version=2, content_hash=second, previous_hash=first, content="second contract"),
    ]
    assert verify_revision_chain(rows) is True


def test_contract_revision_chain_detects_tampering():
    rows = [
        {"version": 1, "content_hash": contract_content_hash("first"), "previous_hash": "", "content": "first"},
        {"version": 2, "content_hash": contract_content_hash("second"), "previous_hash": "wrong", "content": "second"},
    ]
    assert verify_revision_chain(rows) is False


def test_contract_revision_chain_detects_missing_version():
    rows = [
        {"version": 1, "content_hash": contract_content_hash("first"), "previous_hash": "", "content": "first"},
        {"version": 3, "content_hash": contract_content_hash("third"), "previous_hash": contract_content_hash("first"), "content": "third"},
    ]
    assert verify_revision_chain(rows) is False


def test_empty_contract_revision_chain_is_valid():
    assert verify_revision_chain([]) is True


def test_contract_revision_chain_detects_content_tampering():
    rows = [{"version": 1, "content_hash": contract_content_hash("original"), "previous_hash": "", "content": "tampered"}]
    assert verify_revision_chain(rows) is False

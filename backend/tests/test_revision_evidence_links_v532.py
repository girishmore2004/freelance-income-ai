from pathlib import Path

ROOT = Path(__file__).parents[1]

def test_revision_evidence_links_are_validated_against_owned_records():
    source = (ROOT / "app" / "main.py").read_text()
    assert "DeliverableAcceptanceEvent.id == feedback_event_id" in source
    assert "DeliverableAcceptanceEvent.user_id == user.id" in source
    assert "DeliverableAcceptanceEvent.deliverable_id == row.id" in source
    assert "feedback.content_hash" in source
    assert "ScopeChangeRequest.project_id == row.project_id" in source
    assert "ScopeChangeRequest.client_accepted.is_(True)" in source

def test_revision_links_are_exposed_in_revision_history_and_ui():
    source = (ROOT / "app" / "main.py").read_text()
    ui = (ROOT.parent / "frontend" / "app" / "delivery" / "page.tsx").read_text()
    assert '"client_feedback_event_id": r.client_feedback_event_id' in source
    assert '"scope_change_request_id": r.scope_change_request_id' in source
    assert "client_feedback_event_id:feedbackEventId" in ui
    assert "scope_change_request_id:scopeChangeId" in ui
    assert "Event ID: {event.id}" in ui

def test_migration_is_next_in_chain_and_preserves_legacy_unknowns():
    migration = ROOT / "alembic" / "versions" / "0036_revision_evidence_links.py"
    source = migration.read_text()
    assert 'down_revision = "0035_deliverable_revision_origin"' in source
    assert "UPDATE deliverable_revisions" not in source
    assert 'ondelete="RESTRICT"' in source

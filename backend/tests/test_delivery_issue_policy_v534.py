import pytest
from app.services.delivery_issue_policy import validate_issue_update


def test_open_issue_can_be_triaged_without_resolution_evidence():
    validate_issue_update("open", "triaged", "high", "", "", "")


def test_starting_work_requires_corrective_action():
    with pytest.raises(ValueError, match="corrective action"):
        validate_issue_update("triaged", "in_progress", "medium", "", "", "")


def test_resolving_requires_action_note_and_evidence():
    with pytest.raises(ValueError, match="Resolution requires"):
        validate_issue_update("in_progress", "resolved", "high", "Fix the defect", "Fixed", "")
    validate_issue_update("in_progress", "resolved", "high", "Fix the defect", "Fixed and retested", "test-report-123")


def test_closed_issue_must_first_be_resolved():
    with pytest.raises(ValueError, match="Invalid issue status transition"):
        validate_issue_update("in_progress", "closed", "medium", "Corrected issue", "Resolved", "evidence-123")
    validate_issue_update("resolved", "closed", "medium", "Corrected issue", "Resolved", "evidence-123")


def test_closed_issue_is_terminal():
    with pytest.raises(ValueError, match="Invalid issue status transition"):
        validate_issue_update("closed", "in_progress", "medium", "Corrected issue", "Resolved", "evidence-123")


def test_severity_is_bounded():
    with pytest.raises(ValueError, match="Severity"):
        validate_issue_update("open", "triaged", "urgent", "", "", "")


def test_resolved_issue_can_be_reopened_for_more_work():
    validate_issue_update("resolved", "in_progress", "medium", "Additional corrective work", "Prior resolution", "prior-evidence")


def test_migration_is_chained_after_v533_and_uses_restrictive_evidence_fks():
    from pathlib import Path
    migration = Path(__file__).parents[1] / "alembic" / "versions" / "0038_delivery_issue_workflow.py"
    source = migration.read_text()
    assert 'down_revision = "0037_delivery_audit_hash_chain"' in source
    assert 'sa.ForeignKey("deliverable_revisions.id", ondelete="RESTRICT")' in source
    assert 'sa.ForeignKey("deliverable_acceptance_events.id", ondelete="RESTRICT")' in source


def test_issue_api_uses_exact_revision_and_audit_chain():
    from pathlib import Path
    source = (Path(__file__).parents[1] / "app" / "main.py").read_text()
    assert 'def create_delivery_issue' in source
    assert 'DeliverableRevision.id == revision_id' in source
    assert 'def update_delivery_issue' in source
    assert 'event_type="delivery_issue_created"' in source
    assert 'event_type="delivery_issue_updated"' in source

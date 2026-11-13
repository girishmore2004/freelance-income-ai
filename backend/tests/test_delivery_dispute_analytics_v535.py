from datetime import datetime, timezone, timedelta
from types import SimpleNamespace
from pathlib import Path

from app.services.delivery_dispute_analytics import summarize_delivery_issues


def issue(issue_id="i1", **kwargs):
    values = dict(id=issue_id, project_id="p1", severity="high", status="open",
                  root_cause="quality_defect", due_date="2026-11-12",
                  created_at=datetime(2026, 11, 10, tzinfo=timezone.utc), resolved_at=None)
    values.update(kwargs)
    return SimpleNamespace(**values)


def test_overdue_open_issue_and_root_cause_are_explicit():
    result = summarize_delivery_issues([issue()], [], datetime(2026, 11, 13, tzinfo=timezone.utc))
    overall = result["overall"]
    assert overall["overdue_open_count"] == 1
    assert overall["unresolved_count"] == 1
    assert overall["root_cause_counts"] == {"quality_defect": 1}
    assert overall["median_minutes_to_resolution"] is None


def test_triage_and_resolution_durations_require_recorded_timestamps():
    row = issue(status="resolved", resolved_at=datetime(2026, 11, 11, tzinfo=timezone.utc))
    event = SimpleNamespace(detail="Issue i1: open → triaged; severity=high.",
                            created_at=datetime(2026, 11, 10, 2, tzinfo=timezone.utc))
    result = summarize_delivery_issues([row], [event], datetime(2026, 11, 13, tzinfo=timezone.utc))["overall"]
    assert result["median_minutes_to_triage"] == 120
    assert result["triage_sample_count"] == 1
    assert result["median_minutes_to_resolution"] == 1440
    assert result["resolution_sample_count"] == 1
    assert result["overdue_open_count"] == 0


def test_invalid_due_dates_are_not_marked_overdue_and_missing_cause_is_unknown():
    row = issue(due_date="not-a-date", root_cause="unclassified")
    result = summarize_delivery_issues([row], [], datetime(2026, 11, 13, tzinfo=timezone.utc))["overall"]
    assert result["overdue_open_count"] == 0
    assert result["root_cause_counts"] == {"unclassified": 1}
    assert result["sample_quality"] == "descriptive_only"


def test_project_aggregation_is_user_scoped_at_api_and_migration_is_chained():
    root = Path(__file__).parents[1]
    main = (root / "app" / "main.py").read_text()
    migration = (root / "alembic" / "versions" / "0039_delivery_issue_root_cause.py").read_text()
    assert '@app.get("/api/v1/analytics/delivery-disputes")' in main
    assert 'DeliveryIssue.user_id == user.id' in main
    assert 'down_revision = "0038_delivery_issue_workflow"' in migration
    assert 'sa.Column("root_cause", sa.String(length=40)' in migration

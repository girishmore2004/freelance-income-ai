from datetime import date, datetime, timezone
from types import SimpleNamespace as NS

from app.services.delivery_performance import build_delivery_performance


def test_effort_variance_and_completion_schedule_variance_are_grounded():
    project = NS(id="p1", title="Client portal", status="active")
    task = NS(id="t1", project_id="p1", title="Build API", status="done", estimated_hours=10,
              planned_finish_date="2026-11-10", completed_at=datetime(2026, 11, 12, 10, tzinfo=timezone.utc))
    entries = [NS(task_id="t1", duration_minutes=360), NS(task_id="t1", duration_minutes=300)]
    result = build_delivery_performance([task], [project], entries, today=date(2026, 11, 13))
    row = result["tasks"][0]
    assert row["actual_logged_hours"] == 11
    assert row["effort_variance_hours"] == 1
    assert row["effort_variance_percent"] == 10
    assert row["schedule_variance_days"] == 2
    assert result["summary"]["median_absolute_effort_error_percent"] == 10
    assert result["summary"]["under_estimated_tasks"] == 1
    assert result["summary"]["over_estimated_tasks"] == 0


def test_missing_time_logs_and_estimates_stay_unknown_not_zero():
    project = NS(id="p1", title="Website", status="active")
    task = NS(id="t1", project_id="p1", title="Unestimated task", status="in_progress",
              estimated_hours=None, planned_finish_date="", completed_at=None)
    result = build_delivery_performance([task], [project], [], today=date(2026, 11, 13))
    row = result["tasks"][0]
    assert row["actual_logged_hours"] is None
    assert row["effort_variance_hours"] is None
    assert row["remaining_estimated_hours"] is None
    assert row["time_tracking_status"] == "missing"
    assert result["summary"]["tasks_missing_time_logs"] == 1
    assert result["summary"]["tasks_missing_estimates"] == 1
    assert result["summary"]["median_absolute_effort_error_percent"] is None


def test_project_metrics_require_comparable_completed_sample():
    project = NS(id="p1", title="Mobile app", status="active")
    tasks = [NS(id=f"t{i}", project_id="p1", title=f"Task {i}", status="done", estimated_hours=5,
                planned_finish_date="", completed_at=None) for i in range(2)]
    entries = [NS(task_id="t1", duration_minutes=360)]
    result = build_delivery_performance(tasks, [project], entries, today=date(2026, 11, 13))
    project_row = result["projects"][0]
    assert project_row["completed_tasks"] == 2
    assert project_row["completed_tasks_comparable"] == 1
    assert project_row["data_quality"] == "small_sample"
    assert project_row["tasks_missing_time_logs"] == 1


def test_closed_project_is_excluded_and_cancelled_task_not_used_for_accuracy():
    projects = [NS(id="p1", title="Archived", status="completed")]
    task = NS(id="t1", project_id="p1", title="Old", status="done", estimated_hours=2,
              planned_finish_date="", completed_at=None)
    result = build_delivery_performance([task], projects, [NS(task_id="t1", duration_minutes=60)])
    assert result["tasks"] == []
    assert result["projects"] == []


def test_todo_task_without_time_logs_is_not_flagged_as_missing_tracking():
    project = NS(id="p1", title="Landing page", status="active")
    task = NS(id="t1", project_id="p1", title="Not started", status="todo", estimated_hours=3,
              planned_finish_date="", completed_at=None)
    result = build_delivery_performance([task], [project], [])
    row = result["tasks"][0]
    assert row["time_tracking_status"] == "not_started"
    assert row["remaining_estimated_hours"] == 3
    assert result["summary"]["tasks_missing_time_logs"] == 0

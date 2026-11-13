from datetime import date
from types import SimpleNamespace
from app.services.commitment_planning import build_commitment_plan


def task(**kw):
    values = dict(id="t1", project_id="p1", title="Build API", status="todo", estimated_hours=14,
                  planned_start_date="2026-11-16", due_date="2026-11-22")
    values.update(kw)
    return SimpleNamespace(**values)


def test_allocates_estimated_effort_to_overlapping_week():
    p = SimpleNamespace(id="p1", title="Client project", status="active")
    result = build_commitment_plan([task()], [p], 10, today=date(2026, 11, 16), horizon_weeks=2)
    assert result["scheduled_task_count"] == 1
    assert result["weeks"][0]["planned_hours"] == 14
    assert result["weeks"][0]["over_capacity_hours"] == 4
    assert result["weeks"][0]["status"] == "over_capacity"


def test_missing_dates_and_effort_are_reported_not_zeroed():
    p = SimpleNamespace(id="p1", title="Client project", status="active")
    result = build_commitment_plan([
        task(id="t2", planned_start_date=""),
        task(id="t3", estimated_hours=None, planned_start_date="2026-11-16"),
    ], [p], 10, today=date(2026, 11, 16), horizon_weeks=2)
    assert result["unscheduled_task_count"] == 1
    assert result["unknown_effort_task_count"] == 1
    assert result["weeks"][0]["planned_hours"] == 0


def test_completed_tasks_are_excluded_and_cross_week_work_is_split():
    p = SimpleNamespace(id="p1", title="Client project", status="active")
    result = build_commitment_plan([
        task(id="t4", estimated_hours=14, planned_start_date="2026-11-20", due_date="2026-11-26"),
        task(id="t5", status="done", estimated_hours=100),
    ], [p], 20, today=date(2026, 11, 16), horizon_weeks=3)
    assert result["scheduled_task_count"] == 1
    assert result["weeks"][0]["planned_hours"] == 6
    assert result["weeks"][1]["planned_hours"] == 8

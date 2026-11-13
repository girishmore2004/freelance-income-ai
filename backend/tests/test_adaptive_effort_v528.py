from types import SimpleNamespace as NS

from app.services.adaptive_effort import build_adaptive_effort_suggestions


def task(i, title, status="done", estimate=None, description=""):
    return NS(id=f"t{i}", project_id="p1", title=title, status=status,
              estimated_hours=estimate, description=description)


def entry(task_id, minutes):
    return NS(task_id=task_id, duration_minutes=minutes)


def test_similar_completed_tasks_produce_median_and_range_without_mutating_target():
    rows = [task(1, "Build React dashboard", estimate=4),
            task(2, "Build React analytics dashboard", estimate=6),
            task(3, "Create React dashboard charts", estimate=8),
            task(4, "Build React dashboard for reporting", status="todo", estimate=5)]
    result = build_adaptive_effort_suggestions(rows, [entry("t1", 300), entry("t2", 420), entry("t3", 540)])
    suggestion = next(x for x in result["suggestions"] if x["task_id"] == "t4")
    assert suggestion["recommended_hours"] == 7
    assert suggestion["suggested_range_hours"]["low"] <= 7 <= suggestion["suggested_range_hours"]["high"]
    assert suggestion["current_estimated_hours"] == 5
    assert suggestion["estimate_difference_hours"] == 2
    assert rows[-1].estimated_hours == 5


def test_insufficient_history_does_not_invent_estimate():
    rows = [task(1, "Implement payment API", status="done"), task(2, "Implement payment API retry", status="todo")]
    result = build_adaptive_effort_suggestions(rows, [entry("t1", 240)])
    row = next(x for x in result["suggestions"] if x["task_id"] == "t2")
    assert row["recommended_hours"] is None
    assert row["confidence"] == "insufficient"
    assert row["reason_code"] == "insufficient_similar_history"


def test_unrelated_history_is_not_used_and_closed_tasks_are_not_targets():
    rows = [task(1, "Build React frontend", status="done"),
            task(2, "Configure PostgreSQL backup", status="done"),
            task(3, "Configure PostgreSQL backup", status="todo"),
            task(4, "Build React frontend", status="completed"),
            task(5, "Configure PostgreSQL automated backup", status="completed")]
    result = build_adaptive_effort_suggestions(rows, [entry("t1", 240), entry("t2", 180), entry("t4", 300), entry("t5", 300)])
    assert [x["task_id"] for x in result["suggestions"]] == ["t3"]
    assert result["suggestions"][0]["recommended_hours"] == 4


def test_confidence_reflects_sample_size_and_dispersion():
    rows = [task(i, "Create invoice PDF generator", status="done") for i in range(1, 9)]
    rows.append(task(9, "Create invoice PDF generator enhancement", status="todo"))
    entries = [entry(f"t{i}", 240) for i in range(1, 9)]
    result = build_adaptive_effort_suggestions(rows, entries)
    row = next(x for x in result["suggestions"] if x["task_id"] == "t9")
    assert row["similar_completed_tasks"] == 8
    assert row["confidence"] == "high"
    assert row["recommended_hours"] == 4

from datetime import date, timedelta
from types import SimpleNamespace as NS
from app.services.capacity_planning import build_capacity_plan


def row(**kwargs):
    return NS(**kwargs)


def test_capacity_uses_observed_active_project_load_and_deadline_window():
    today = date(2026, 11, 13)
    profile = row(weekly_hours=20)
    projects = [row(id="p1", title="Client portal", status="active")]
    # 40 hours over 28 days = 10 hours/week observed; 10h/week remains.
    entries = [row(project_id="p1", work_date=(today - timedelta(days=i)).isoformat(), duration_minutes=600, billable=True)
               for i in (1, 8, 15, 22)]
    opportunities = [row(id="o1", title="Build dashboard", estimated_hours=15,
                         deadline=(today + timedelta(days=14)).isoformat())]
    result = build_capacity_plan(opportunities, profile, projects, [], entries, today=today)
    assert result["observed_active_project_hours_per_week"] == 10
    assert result["estimated_remaining_weekly_capacity_hours"] == 10
    item = result["opportunities"][0]
    assert item["capacity_available_before_deadline_hours"] == 20
    assert item["capacity_status"] == "feasible_on_observed_baseline"


def test_untracked_active_project_reduces_confidence_and_is_disclosed():
    today = date(2026, 11, 13)
    projects = [row(id="p1", title="Untracked client", status="active")]
    opportunities = [row(id="o1", title="Job", estimated_hours=8,
                         deadline=(today + timedelta(days=7)).isoformat())]
    result = build_capacity_plan(opportunities, row(weekly_hours=10), projects, [], [], today=today)
    assert result["untracked_active_projects"] == ["Untracked client"]
    assert result["workload_data_coverage_percent"] == 0
    assert result["opportunities"][0]["confidence"] == "low"
    assert result["opportunities"][0]["capacity_status"] == "feasible_on_observed_baseline"
    assert "no time logs" in " ".join(result["opportunities"][0]["reasons"])


def test_missing_effort_or_deadline_is_unknown_not_assumed_feasible():
    today = date(2026, 11, 13)
    opportunities = [
        row(id="a", title="No estimate", estimated_hours=None, deadline=(today + timedelta(days=4)).isoformat()),
        row(id="b", title="No deadline", estimated_hours=5, deadline=""),
        row(id="c", title="Past deadline", estimated_hours=2, deadline=(today - timedelta(days=1)).isoformat()),
    ]
    result = build_capacity_plan(opportunities, row(weekly_hours=10), [], [], [], today=today)
    by_id = {x["opportunity_id"]: x for x in result["opportunities"]}
    assert by_id["a"]["capacity_status"] == "unknown_effort"
    assert by_id["b"]["capacity_status"] == "unknown_deadline"
    assert by_id["c"]["capacity_status"] == "deadline_passed"
    assert by_id["a"]["capacity_available_before_deadline_hours"] is None


def test_closed_projects_are_not_counted_as_active_workload():
    today = date(2026, 11, 13)
    projects = [row(id="done", title="Completed", status="completed")]
    entries = [row(project_id="done", work_date=today.isoformat(), duration_minutes=600, billable=True)]
    result = build_capacity_plan([], row(weekly_hours=12), projects, [], entries, today=today)
    assert result["active_projects"] == 0
    assert result["observed_active_project_hours_per_week"] == 0
    assert result["estimated_remaining_weekly_capacity_hours"] == 12

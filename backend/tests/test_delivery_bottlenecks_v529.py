from datetime import date
from types import SimpleNamespace as NS

from app.services.delivery_bottlenecks import build_delivery_bottlenecks


def test_dependency_chain_and_overdue_task_are_review_candidates():
    project = NS(id="p1", title="Client portal", status="active")
    tasks = [
        NS(id="a", project_id="p1", title="API", status="in_progress", due_date="2026-11-12", estimated_hours=8),
        NS(id="b", project_id="p1", title="UI", status="todo", due_date="2026-11-20", estimated_hours=5),
        NS(id="c", project_id="p1", title="QA", status="todo", due_date="", estimated_hours=None),
    ]
    edges = [NS(id="e1", project_id="p1", predecessor_task_id="a", successor_task_id="b"),
             NS(id="e2", project_id="p1", predecessor_task_id="b", successor_task_id="c")]
    result = build_delivery_bottlenecks(tasks, [project], edges, [], [], today=date(2026, 11, 13))
    rows = {r["task_id"]: r for r in result["bottleneck_candidates"]}
    assert rows["a"]["overdue"] is True
    assert rows["a"]["critical_path_candidate"] is True
    assert rows["a"]["successor_count"] == 1
    assert rows["c"]["signals"] == ["critical_dependency_path", "effort_estimate_missing"]
    assert result["summary"]["bottleneck_review_candidates"] >= 1


def test_revision_activity_counts_additional_versions_without_claiming_rework():
    project = NS(id="p1", title="Website", status="active")
    deliverable = NS(id="d1", project_id="p1", task_id="t1", title="Landing page", status="draft", review_note="Please adjust CTA")
    revisions = [NS(id="r1", deliverable_id="d1", version=1), NS(id="r2", deliverable_id="d1", version=2), NS(id="r3", deliverable_id="d1", version=3)]
    result = build_delivery_bottlenecks([], [project], [], [deliverable], revisions, today=date(2026, 11, 13))
    row = result["deliverable_revision_activity"][0]
    assert row["revision_versions"] == 3
    assert row["additional_revisions_after_initial"] == 2
    assert row["review_note_present"] is True
    assert "does not establish avoidable rework" in result["limitations"][2]


def test_cycles_are_flagged_and_closed_projects_excluded():
    active = NS(id="p1", title="Active", status="active")
    closed = NS(id="p2", title="Closed", status="completed")
    tasks = [NS(id="a", project_id="p1", title="A", status="todo", due_date="", estimated_hours=2),
             NS(id="b", project_id="p1", title="B", status="todo", due_date="", estimated_hours=2),
             NS(id="c", project_id="p2", title="C", status="todo", due_date="", estimated_hours=2)]
    edges = [NS(id="e1", project_id="p1", predecessor_task_id="a", successor_task_id="b"),
             NS(id="e2", project_id="p1", predecessor_task_id="b", successor_task_id="a")]
    result = build_delivery_bottlenecks(tasks, [active, closed], edges, [], [])
    assert result["summary"]["projects_with_dependency_cycles"] == 1
    assert len(result["projects"]) == 1
    assert all(r["project_id"] == "p1" for r in result["bottleneck_candidates"])


def test_missing_revision_history_is_not_reported_as_zero_rework():
    project = NS(id="p1", title="Project", status="active")
    deliverable = NS(id="d1", project_id="p1", task_id=None, title="Report", status="draft", review_note="")
    result = build_delivery_bottlenecks([], [project], [], [deliverable], [])
    assert result["deliverable_revision_activity"][0]["revision_versions"] == 0
    assert result["projects"][0]["rework_data_quality"] == "no_deliverable_revision_records"

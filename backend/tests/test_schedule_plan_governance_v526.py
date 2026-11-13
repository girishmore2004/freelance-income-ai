from types import SimpleNamespace as NS
from app.services.schedule_plan_governance import fingerprint_schedule_inputs


def test_schedule_fingerprint_is_deterministic_and_order_independent():
    tasks = [NS(id="t1", project_id="p1", status="todo", priority="high", estimated_hours=4,
                planned_start_date="", due_date="2026-12-01", planned_finish_date="")]
    projects = [NS(id="p1", status="active", title="Project")]
    dependencies = [NS(predecessor_task_id="a", successor_task_id="b")]
    blocks = [NS(block_date="2026-11-20", unavailable_hours=4, kind="leave")]
    milestones = [NS(id="m1", project_id="p1", status="pending", due_date="2026-12-05")]
    a = fingerprint_schedule_inputs(tasks, projects, dependencies, blocks, 20, milestones)
    b = fingerprint_schedule_inputs(list(reversed(tasks)), list(reversed(projects)), list(reversed(dependencies)),
                                    list(reversed(blocks)), 20, list(reversed(milestones)))
    assert a == b


def test_schedule_fingerprint_changes_when_task_or_calendar_input_changes():
    task = NS(id="t1", project_id="p1", status="todo", priority="high", estimated_hours=4,
              planned_start_date="", due_date="2026-12-01", planned_finish_date="")
    project = NS(id="p1", status="active", title="Project")
    baseline = fingerprint_schedule_inputs([task], [project], [], [], 20, [])
    task.estimated_hours = 8
    changed_effort = fingerprint_schedule_inputs([task], [project], [], [], 20, [])
    assert baseline != changed_effort
    task.estimated_hours = 4
    changed_capacity = fingerprint_schedule_inputs([task], [project], [], [], 15, [])
    assert baseline != changed_capacity
    changed_milestone = fingerprint_schedule_inputs([task], [project], [], [], 20,
        [NS(id="m", project_id="p1", status="pending", due_date="2026-11-30")])
    assert baseline != changed_milestone

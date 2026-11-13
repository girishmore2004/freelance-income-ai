from datetime import date
from types import SimpleNamespace as NS
from app.services.schedule_recommendations import build_schedule_recommendations

def task(id, title, hours, project='p', start='', due='', priority='medium', status='todo'):
    return NS(id=id,title=title,estimated_hours=hours,project_id=project,planned_start_date=start,
              due_date=due,priority=priority,status=status)
def dep(id, before, after, project='p'):
    return NS(id=id,predecessor_task_id=before,successor_task_id=after,project_id=project)
def test_scheduler_respects_dependency_and_weekday_capacity():
    tasks=[task('a','Design',8),task('b','Build',8)]
    projects=[NS(id='p',title='Website',status='active')]
    result=build_schedule_recommendations(tasks,projects,[dep('d','a','b')],[],40,today=date(2026,11,16))
    rows={r['task_id']:r for r in result['recommendations']}
    assert rows['a']['recommended_start']=='2026-11-16'
    assert rows['a']['recommended_finish']=='2026-11-16'
    assert rows['b']['recommended_start']=='2026-11-17'
def test_calendar_blocks_reduce_daily_capacity_and_late_is_flagged():
    tasks=[task('a','Build',8,due='2026-11-16')]
    projects=[NS(id='p',title='Website',status='active')]
    blocks=[NS(block_date='2026-11-16',unavailable_hours=8)]
    result=build_schedule_recommendations(tasks,projects,[],blocks,40,today=date(2026,11,16))
    row=result['recommendations'][0]
    assert row['recommended_start']=='2026-11-17'
    assert row['status']=='projected_late'
def test_unknown_effort_and_dependency_cycles_are_not_fabricated():
    tasks=[task('a','A',None),task('b','B',2)]
    projects=[NS(id='p',title='P',status='active')]
    result=build_schedule_recommendations(tasks,projects,[dep('1','a','b'),dep('2','b','a')],[],40,today=date(2026,11,16))
    assert all(x['status']=='blocked_dependency_cycle' for x in result['recommendations'])
def test_successor_is_blocked_when_predecessor_effort_is_unknown():
    tasks=[task('a','Unknown predecessor',None),task('b','Successor',3)]
    projects=[NS(id='p',title='P',status='active')]
    result=build_schedule_recommendations(tasks,projects,[dep('1','a','b')],[],40,today=date(2026,11,16))
    rows={x['task_id']:x for x in result['recommendations']}
    assert rows['a']['status']=='missing_effort'
    assert rows['b']['status']=='blocked_predecessor_unscheduled'

def test_milestone_impact_is_reported_when_projected_finish_is_late():
    tasks=[task('a','Build',16,due='2026-11-17')]
    projects=[NS(id='p',title='P',status='active')]
    milestones=[NS(id='m',project_id='p',title='Client demo',due_date='2026-11-16',status='pending')]
    result=build_schedule_recommendations(tasks,projects,[],[],40,milestones=milestones,today=date(2026,11,16))
    assert result['milestone_impacts'][0]['status']=='projected_at_risk'

def test_completed_project_tasks_are_excluded():
    tasks=[task('a','Done',5,status='completed')]
    projects=[NS(id='p',title='P',status='active')]
    result=build_schedule_recommendations(tasks,projects,[],[],40,today=date(2026,11,16))
    assert result['recommendations']==[]

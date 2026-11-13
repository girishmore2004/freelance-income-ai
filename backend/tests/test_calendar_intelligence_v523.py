from datetime import date
from types import SimpleNamespace as NS
from app.services.calendar_intelligence import build_calendar_intelligence

def obj(**kw): return NS(**kw)

def test_unavailable_hours_reduce_capacity_and_leave_plan_intact():
    today=date(2026,11,16)  # Monday
    project=obj(id='p',title='Client build',status='active')
    task=obj(id='t',project_id='p',title='API delivery',status='todo',estimated_hours=12,planned_start_date='2026-11-16',due_date='2026-11-17')
    block=obj(id='b',block_date='2026-11-16',unavailable_hours=8,kind='leave',note='Leave')
    out=build_calendar_intelligence([task],[project],[],[block],40,today=today,horizon_weeks=2)
    assert out['weeks'][0]['weekly_capacity_hours']==40
    assert out['weeks'][0]['unavailable_hours']==8
    assert out['weeks'][0]['effective_capacity_hours']==32
    assert out['weeks'][0]['planned_hours']==12

def test_date_collisions_between_task_and_milestone_are_explained():
    p=obj(id='p',title='Project',status='active')
    t=obj(id='t',project_id='p',title='Build',status='todo',estimated_hours=4,planned_start_date='2026-11-16',due_date='2026-11-18')
    m=obj(id='m',project_id='p',title='Client review',status='pending',due_date='2026-11-18')
    out=build_calendar_intelligence([t],[p],[m],[],20,today=date(2026,11,16),horizon_weeks=2)
    assert len(out['deadline_date_collisions'])==1
    assert {x['type'] for x in out['deadline_date_collisions'][0]['items']}=={'task','milestone'}

def test_closed_items_and_past_blocks_are_not_counted():
    p=obj(id='p',title='Project',status='active')
    t=obj(id='t',project_id='p',title='Done',status='done',estimated_hours=10,planned_start_date='2026-11-16',due_date='2026-11-17')
    b=obj(id='old',block_date='2026-11-10',unavailable_hours=8,kind='holiday',note='Past')
    out=build_calendar_intelligence([t],[p],[],[b],20,today=date(2026,11,16),horizon_weeks=1)
    assert out['weeks'][0]['planned_hours']==0
    assert out['weeks'][0]['unavailable_hours']==0
    assert out['availability_blocks']==[]

def test_missing_start_or_effort_does_not_invent_planned_hours():
    p=obj(id='p',title='Project',status='active')
    t=obj(id='t',project_id='p',title='Unscheduled',status='todo',estimated_hours=None,planned_start_date='',due_date='2026-11-18')
    out=build_calendar_intelligence([t],[p],[],[],20,today=date(2026,11,16),horizon_weeks=1)
    assert out['weeks'][0]['planned_hours']==0
    assert 'Only manually entered' in out['limitations'][0]

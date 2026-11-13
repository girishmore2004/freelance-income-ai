from datetime import date
from types import SimpleNamespace as NS
from app.services.dependency_planning import build_dependency_plan

def task(id, title, hours=1, status='todo', project='p1', start='', due=''):
    return NS(id=id, title=title, estimated_hours=hours, status=status, project_id=project,
              planned_start_date=start, due_date=due)

def dep(id, before, after, project='p1'):
    return NS(id=id, predecessor_task_id=before, successor_task_id=after, project_id=project)

def test_longest_path_and_parallel_branch_are_explained():
    tasks=[task('a','Design',2),task('b','API',5),task('c','UI',3),task('d','Integration',4)]
    project=NS(id='p1',title='Client build',status='active')
    result=build_dependency_plan(tasks,[project],[dep('1','a','b'),dep('2','a','c'),dep('3','b','d'),dep('4','c','d')],today=date(2026,11,13))
    row=result['projects'][0]
    assert row['has_cycle'] is False
    assert row['critical_path_hours']==11
    assert row['critical_path_task_ids']==['a','b','d']
    assert row['dependency_count']==4

def test_cycle_is_flagged_and_no_false_critical_path_is_reported():
    tasks=[task('a','A',2),task('b','B',3)]
    project=NS(id='p1',title='Cycle project',status='active')
    result=build_dependency_plan(tasks,[project],[dep('1','a','b'),dep('2','b','a')])
    row=result['projects'][0]
    assert row['has_cycle'] is True
    assert row['critical_path_hours'] is None
    assert set(row['cycle_task_ids'])=={'a','b'}

def test_missing_effort_is_unknown_not_assumed_as_real_zero_effort():
    tasks=[task('a','Scoping',None),task('b','Build',4)]
    project=NS(id='p1',title='Unknown work',status='active')
    result=build_dependency_plan(tasks,[project],[dep('1','a','b')])
    row=result['projects'][0]
    assert row['unknown_effort_task_ids']==['a']
    assert row['risk']=='unknown_effort'
    assert row['critical_path_hours']==4

def test_closed_projects_are_excluded_and_due_before_successor_start_is_flagged():
    tasks=[task('a','Build',3,due='2026-11-20'),task('b','Test',2,start='2026-11-18')]
    projects=[NS(id='p1',title='Active',status='active'),NS(id='p2',title='Archived',status='archived')]
    tasks.append(task('z','Old task',100,project='p2'))
    result=build_dependency_plan(tasks,projects,[dep('1','a','b')])
    assert len(result['projects'])==1
    assert result['projects'][0]['schedule_conflicts'][0]['successor']=='Test'

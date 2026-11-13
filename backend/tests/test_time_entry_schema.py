import pytest
from pydantic import ValidationError
from app.schemas import TimeEntryIn

def test_time_entry_accepts_valid_work_log():
    item=TimeEntryIn(project_id="project-1",work_date="2026-11-12",
                     duration_minutes=90,description="API implementation",
                     hourly_rate=1200,currency="INR",billable=True)
    assert item.duration_minutes == 90
    assert item.hourly_rate == 1200

@pytest.mark.parametrize("minutes",[0,-1,1441])
def test_time_entry_rejects_invalid_duration(minutes):
    with pytest.raises(ValidationError):
        TimeEntryIn(project_id="project-1",work_date="2026-11-12",duration_minutes=minutes)

def test_time_entry_rejects_invalid_currency_length():
    with pytest.raises(ValidationError):
        TimeEntryIn(project_id="project-1",work_date="2026-11-12",duration_minutes=60,currency="X")

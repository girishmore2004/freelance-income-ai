from app.services.source_health import retry_delay_minutes, health_status_for_failures

def test_retry_delay_grows_exponentially_and_caps_at_one_day():
    assert retry_delay_minutes(1) == 2
    assert retry_delay_minutes(2) == 4
    assert retry_delay_minutes(5) == 32
    assert retry_delay_minutes(20) == 1440

def test_health_status_uses_consecutive_failures():
    assert health_status_for_failures(0) == "healthy"
    assert health_status_for_failures(1) == "degraded"
    assert health_status_for_failures(2) == "degraded"
    assert health_status_for_failures(3) == "failing"

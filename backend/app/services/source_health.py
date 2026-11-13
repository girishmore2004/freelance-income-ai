"""Deterministic source-health and retry policy helpers."""
def retry_delay_minutes(consecutive_failures: int) -> int:
    """Exponential retry delay, capped at 24 hours."""
    failures = max(1, int(consecutive_failures))
    return min(24 * 60, 2 ** min(failures, 11))

def health_status_for_failures(consecutive_failures: int) -> str:
    failures = max(0, int(consecutive_failures))
    if failures == 0:
        return "healthy"
    return "degraded" if failures < 3 else "failing"

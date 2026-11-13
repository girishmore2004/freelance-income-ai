"""One-shot retention task. Run hourly as a Render Cron Job.

Command (from backend/): python -m app.retention_cleanup
"""
from .database import SessionLocal
from .services.upwork_retention import expire_stale_upwork_listings


def main() -> int:
    db = SessionLocal()
    try:
        expired = expire_stale_upwork_listings(db)
        db.commit()
        print(f"Upwork listing retention cleanup completed: {expired} records redacted")
        return expired
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()

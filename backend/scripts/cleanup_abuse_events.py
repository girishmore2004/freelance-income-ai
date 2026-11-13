"""Dry-run-first retention cleanup for abuse telemetry.

Usage:
  python scripts/cleanup_abuse_events.py
  python scripts/cleanup_abuse_events.py --retention-days 180 --apply
"""
import argparse
from app.database import SessionLocal
from app.services.usage_quota import cleanup_abuse_events


def main():
    parser = argparse.ArgumentParser(description="Review or delete expired abuse telemetry")
    parser.add_argument("--retention-days", type=int, default=90)
    parser.add_argument("--apply", action="store_true",
                        help="Actually delete eligible rows; omitted means dry-run")
    args = parser.parse_args()
    db = SessionLocal()
    try:
        result = cleanup_abuse_events(db, args.retention_days, args.apply)
        print(result)
    finally:
        db.close()


if __name__ == "__main__":
    main()

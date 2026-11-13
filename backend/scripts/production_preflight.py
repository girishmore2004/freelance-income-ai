"""Validate required production environment settings without printing secrets."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import settings
from app.services.production_config import validate_production_settings


def main():
    if settings.environment.lower() != "production":
        print(json.dumps({
            "valid": False,
            "errors": ["ENVIRONMENT must be set to production before running this preflight."],
            "warnings": [],
        }, indent=2))
        raise SystemExit(2)

    result = validate_production_settings(settings)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["valid"] else 1)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Run the offline synthetic proposal-quality regression benchmark."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.services.proposal_eval import evaluate_fixture_dataset

if __name__ == "__main__":
    result = evaluate_fixture_dataset(ROOT / "backend/tests/fixtures/proposal_quality_v513.json")
    print(json.dumps(result, indent=2))
    raise SystemExit(1 if result["failed"] else 0)

"""Offline regression evaluator for deterministic proposal-quality checks."""
from __future__ import annotations
import json
from pathlib import Path
from typing import Any
from .proposal_quality import evaluate_proposal_quality


def evaluate_fixture_dataset(dataset_path: str | Path) -> dict[str, Any]:
    payload = json.loads(Path(dataset_path).read_text(encoding="utf-8"))
    cases = payload.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError("Benchmark must contain a non-empty cases list")
    ids = [case.get("id") for case in cases]
    if any(not isinstance(value, str) or not value.strip() for value in ids) or len(set(ids)) != len(ids):
        raise ValueError("Benchmark case IDs must be non-empty and unique")
    tp = fp = fn = tn = 0
    passed = []
    for case in cases:
        result = evaluate_proposal_quality(
            case.get("content", ""),
            case.get("opportunity"),
            case.get("proposed_price"),
            case.get("evidence"),
        )
        actual = {flag["code"] for flag in result["flags"]}
        expected = set(case.get("expected_flag_codes", []))
        tp += len(actual & expected)
        fp += len(actual - expected)
        fn += len(expected - actual)
        tn += max(0, len(expected) - len(expected & actual)) == 0 and not actual and not expected
        score_ok = result["score"] >= int(case.get("expected_min_score", 0))
        passed.append({
            "id": case["id"], "pass": actual == expected and score_ok,
            "expected_flags": sorted(expected), "actual_flags": sorted(actual),
            "score": result["score"], "score_threshold": int(case.get("expected_min_score", 0)),
        })
    precision = tp / (tp + fp) if tp + fp else 1.0
    recall = tp / (tp + fn) if tp + fn else 1.0
    return {
        "dataset": payload.get("dataset", "unnamed"),
        "provenance": payload.get("provenance", "unspecified"),
        "case_count": len(cases), "passed": sum(1 for row in passed if row["pass"]),
        "failed": sum(1 for row in passed if not row["pass"]),
        "flag_precision": round(precision, 4), "flag_recall": round(recall, 4),
        "case_results": passed,
        "limitations": [
            "Synthetic fixtures validate deterministic rules only; they do not measure semantic truth or proposal success.",
            "Do not describe this dataset as human-reviewed or representative of real clients.",
            "Metrics are descriptive and must not be used to auto-approve or send proposals.",
        ],
    }

import json
import pytest
from pathlib import Path
from app.services.proposal_eval import evaluate_fixture_dataset


def test_synthetic_proposal_benchmark_passes_all_regressions():
    path = Path(__file__).parent / "fixtures" / "proposal_quality_v513.json"
    result = evaluate_fixture_dataset(path)
    assert result["case_count"] == 8
    assert result["failed"] == 0
    assert result["passed"] == 8
    assert result["provenance"].startswith("Synthetic")


def test_benchmark_rejects_duplicate_case_ids(tmp_path):
    path = tmp_path / "bad.json"
    path.write_text(json.dumps({"cases": [{"id": "same"}, {"id": "same"}]}))
    with pytest.raises(ValueError, match="unique"):
        evaluate_fixture_dataset(path)


def test_benchmark_rejects_empty_dataset(tmp_path):
    path = tmp_path / "empty.json"
    path.write_text(json.dumps({"cases": []}))
    with pytest.raises(ValueError, match="non-empty"):
        evaluate_fixture_dataset(path)

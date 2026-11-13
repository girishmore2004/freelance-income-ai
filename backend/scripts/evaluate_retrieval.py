"""Validate and evaluate a curated retrieval benchmark without network/API calls."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.retrieval_eval import evaluate_retrieval, validate_retrieval_dataset


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", default="evaluation/retrieval_cases.json")
    parser.add_argument("--k", type=int, default=5)
    parser.add_argument("--output", default="")
    args = parser.parse_args()
    if not 1 <= args.k <= 100:
        parser.error("--k must be between 1 and 100")
    path = Path(args.dataset)
    payload = json.loads(path.read_text(encoding="utf-8"))
    errors = validate_retrieval_dataset(payload)
    if errors:
        print(json.dumps({"valid": False, "errors": errors}, indent=2))
        raise SystemExit(2)
    result = evaluate_retrieval(payload["cases"], limit=args.k)
    result.update({
        "valid": True,
        "dataset_name": payload.get("dataset_name", path.name),
        "dataset_version": payload.get("dataset_version", "unknown"),
        "review_status": payload.get("review_status", "unreviewed"),
        "production_quality_gate": payload.get("review_status") == "human_reviewed",
    })
    rendered = json.dumps(result, indent=2)
    print(rendered)
    if args.output:
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered + "\\n", encoding="utf-8")


if __name__ == "__main__":
    main()

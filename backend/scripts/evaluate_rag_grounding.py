"""Run structural validation and offline RAG grounding fixture evaluation."""
import argparse
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.rag_evaluation import evaluate_grounding_cases, validate_grounding_dataset


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default="evaluation/grounding_cases.json")
    parser.add_argument("--threshold", type=float, default=0.6)
    parser.add_argument("--output", default="")
    parser.add_argument("--strict", action="store_true", help="Exit non-zero when dataset labels are not marked human-reviewed")
    args = parser.parse_args()
    if not 0 < args.threshold <= 1:
        parser.error("--threshold must be greater than 0 and at most 1")
    path = Path(args.dataset)
    payload = json.loads(path.read_text(encoding="utf-8"))
    errors = validate_grounding_dataset(payload)
    if errors:
        print(json.dumps({"valid": False, "errors": errors}, indent=2))
        raise SystemExit(2)
    review_status = payload.get("review_status", "synthetic_or_unreviewed")
    if args.strict and review_status != "human_reviewed":
        print("Strict mode requires dataset review_status='human_reviewed'.", file=sys.stderr)
        raise SystemExit(3)
    result = evaluate_grounding_cases(payload.get("cases", []), args.threshold)
    result.update({
        "valid": True,
        "dataset_name": payload.get("dataset_name", path.name),
        "dataset_version": payload.get("dataset_version", "unknown"),
        "review_status": review_status,
        "dataset_labeling": payload.get("labeling", "Not specified"),
        "production_quality_gate": review_status == "human_reviewed",
    })
    rendered = json.dumps(result, indent=2)
    print(rendered)
    if args.output:
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

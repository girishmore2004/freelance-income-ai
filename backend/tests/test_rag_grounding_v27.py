import json
from pathlib import Path
from app.services.rag_evaluation import assess_claim_support, evaluate_grounding_cases


def test_grounding_flags_numeric_contradiction():
    result = assess_claim_support(
        "Reduced processing time by 90 percent.",
        ["Reduced processing time by 40 percent."],
    )
    assert result["numeric_conflict"] is True
    assert result["supported"] is False


def test_grounding_flags_negation_conflict():
    result = assess_claim_support(
        "The project includes payment processing.",
        ["The project does not include payment processing."],
    )
    assert result["negation_conflict"] is True
    assert result["supported"] is False


def test_grounding_accepts_matching_evidence():
    result = assess_claim_support(
        "Built a React dashboard for logistics clients.",
        ["Built a React dashboard for logistics clients."],
    )
    assert result["supported"] is True


def test_human_label_fixture_smoke_metrics():
    dataset = json.loads((Path(__file__).parents[1] / "evaluation" / "grounding_cases.json").read_text())
    result = evaluate_grounding_cases(dataset["cases"])
    assert result["evaluated_claims"] == 8
    assert result["true_positive"] >= 3
    assert result["false_positive"] == 0
    assert result["metric_scope"].startswith("Human-labelled fixture")

from app.services.rag_evaluation import (
    citation_metrics,
    evaluate_grounding_cases,
    validate_grounding_dataset,
)


def test_unknown_citation_ids_are_reported_and_never_count_as_grounded():
    cases = [{
        "case_id": "unknown-citation",
        "claims": [{
            "claim": "Built a React dashboard for logistics deliveries.",
            "cited_evidence_ids": ["missing-id"],
            "evidence": [{"id": "real-id", "text": "Built a React dashboard for logistics deliveries."}],
            "expected_supported": True,
        }],
    }]
    result = evaluate_grounding_cases(cases)
    assert result["unknown_citation_count"] == 1
    assert result["citation_integrity_pass"] is False
    assert result["details"][0]["supported"] is False
    assert result["details"][0]["unknown_citation_ids"] == ["missing-id"]


def test_citation_metrics_can_check_ids_against_retrieved_evidence():
    result = citation_metrics(["a"], ["a", "not-retrieved"], available_ids=["a", "b"])
    assert result["citation_integrity"] == "invalid"
    assert result["unknown_citation_ids"] == ["not-retrieved"]
    assert result["precision"] == 0.5


def test_dataset_validator_accepts_existing_synthetic_fixture_shape():
    payload = {
        "review_status": "synthetic",
        "cases": [{"case_id": "case-1", "claims": [{
            "claim": "A claim", "expected_supported": True,
            "cited_evidence_ids": ["e1"], "evidence": [{"id": "e1", "text": "Evidence"}],
        }]}],
    }
    assert validate_grounding_dataset(payload) == []


def test_human_reviewed_dataset_requires_review_provenance():
    payload = {
        "review_status": "human_reviewed",
        "cases": [{"case_id": "case-1", "claims": [{
            "claim": "A claim", "expected_supported": True,
            "cited_evidence_ids": ["e1"], "evidence": [{"id": "e1", "text": "Evidence"}],
        }]}],
    }
    errors = validate_grounding_dataset(payload)
    assert any("review.reviewed_by" in error for error in errors)


def test_dataset_validator_rejects_unknown_citation_reference():
    payload = {
        "review_status": "unreviewed",
        "cases": [{"case_id": "case-1", "claims": [{
            "claim": "A claim", "expected_supported": False,
            "cited_evidence_ids": ["missing"], "evidence": [{"id": "e1", "text": "Evidence"}],
        }]}],
    }
    assert any("cites evidence IDs" in error for error in validate_grounding_dataset(payload))

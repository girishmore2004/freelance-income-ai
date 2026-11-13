from app.services.retrieval_eval import evaluate_retrieval, validate_retrieval_dataset


def test_retrieval_dataset_validates_and_metrics_are_explained():
    payload = {
        "review_status": "synthetic",
        "cases": [{
            "case_id": "case-1",
            "query": "React dashboard",
            "relevant_chunk_ids": ["right"],
            "chunks": [
                {"id": "wrong", "content": "Python data processing"},
                {"id": "right", "content": "React dashboard frontend"},
            ],
        }],
    }
    assert validate_retrieval_dataset(payload) == []
    result = evaluate_retrieval(payload["cases"], limit=2)
    assert result["evaluated_queries"] == 1
    assert result["recall_at_k"] == 1.0
    assert result["precision_at_k"] == 0.5
    assert result["precision_among_returned"] == 1.0
    assert result["mrr_at_k"] == 1.0
    assert result["ndcg_at_k"] > 0
    assert "label quality" in result["metric_scope"]


def test_retrieval_dataset_rejects_unknown_relevant_chunk_ids():
    payload = {
        "cases": [{
            "case_id": "case-1", "query": "React",
            "relevant_chunk_ids": ["missing"],
            "chunks": [{"id": "known", "content": "React frontend"}],
        }]
    }
    assert any("references chunks not present" in error for error in validate_retrieval_dataset(payload))


def test_retrieval_dataset_rejects_duplicate_ids_and_blank_queries():
    payload = {
        "cases": [{
            "case_id": "case-1", "query": " ",
            "relevant_chunk_ids": ["same"],
            "chunks": [
                {"id": "same", "content": "one"},
                {"id": "same", "content": "two"},
            ],
        }]
    }
    errors = validate_retrieval_dataset(payload)
    assert any(".query" in error for error in errors)
    assert any("duplicate chunk IDs" in error for error in errors)


def test_retrieval_limit_is_bounded():
    try:
        evaluate_retrieval([], limit=0)
    except ValueError as exc:
        assert "between 1 and 100" in str(exc)
    else:
        raise AssertionError("invalid k should fail")

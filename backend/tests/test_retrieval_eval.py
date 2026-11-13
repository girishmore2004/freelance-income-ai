from app.services.retrieval_eval import evaluate_retrieval

def test_evaluation_reports_recall_and_mrr():
    cases = [{
        "query": "React dashboard",
        "chunks": [
            {"id": "irrelevant", "content": "cooking recipe"},
            {"id": "relevant", "content": "React dashboard frontend"},
        ],
        "relevant_chunk_ids": ["relevant"],
    }]
    result = evaluate_retrieval(cases, limit=2)
    assert result["evaluated_queries"] == 1
    assert result["recall_at_k"] == 1.0
    assert result["mrr_at_k"] == 1.0

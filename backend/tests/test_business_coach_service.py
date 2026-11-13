from app.services.retrieval import rank_chunks


def test_coach_retrieval_ranks_relevant_portfolio_evidence():
    chunks = [
        {"id": "a", "content": "Python FastAPI backend and retrieval augmented generation", "embedding": []},
        {"id": "b", "content": "Wedding photography and event albums", "embedding": []},
    ]
    ranked = rank_chunks("Python FastAPI RAG", None, chunks, limit=2)
    assert ranked[0]["id"] == "a"
    assert ranked[0]["retrieval_method"] == "lexical_cosine"


def test_coach_retrieval_returns_no_false_match_for_empty_query():
    ranked = rank_chunks("", None, [{"id": "a", "content": "Python developer", "embedding": []}], limit=5)
    assert ranked == []

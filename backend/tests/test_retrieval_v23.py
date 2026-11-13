from app.services.retrieval import rank_chunks
from app.services.retrieval_eval import evaluate_retrieval


def test_hybrid_retrieval_combines_lexical_and_vector_signals():
    chunks = [
        {"id": "lex", "content": "Python FastAPI backend integration", "embedding": [0.0, 1.0]},
        {"id": "sem", "content": "unrelated wording", "embedding": [1.0, 0.0]},
    ]
    ranked = rank_chunks("Python API integration", [1.0, 0.0], chunks, limit=2, diversity=0)
    assert ranked[0]["id"] == "sem"
    assert ranked[0]["retrieval_method"] == "hybrid_rrf"
    assert ranked[1]["lexical_score"] > 0


def test_hybrid_retrieval_falls_back_to_lexical_when_embedding_missing():
    ranked = rank_chunks("invoice automation", None, [
        {"id": "a", "content": "invoice automation workflow", "embedding": []},
        {"id": "b", "content": "gardening tips", "embedding": []},
    ])
    assert [x["id"] for x in ranked] == ["a"]
    assert ranked[0]["retrieval_method"] == "lexical_cosine"


def test_mmr_reduces_near_duplicate_results():
    chunks = [
        {"id": "a", "content": "Python FastAPI backend API development", "embedding": [1.0, 0.0]},
        {"id": "b", "content": "Python FastAPI backend API development service", "embedding": [0.99, 0.01]},
        {"id": "c", "content": "Python API deployment and cloud hosting", "embedding": [0.8, 0.2]},
    ]
    ranked = rank_chunks("Python FastAPI API", [1.0, 0.0], chunks, limit=3, diversity=0.35)
    assert len(ranked) == 3
    assert all("mmr_score" in item for item in ranked)


def test_retrieval_evaluation_reports_precision_recall_mrr_and_ndcg():
    report = evaluate_retrieval([{
        "query": "Python API",
        "query_embedding": [1.0, 0.0],
        "chunks": [
            {"id": "a", "content": "Python API service", "embedding": [1.0, 0.0]},
            {"id": "b", "content": "unrelated content", "embedding": [0.0, 1.0]},
        ],
        "relevant_chunk_ids": ["a"],
    }], limit=2)
    assert report["evaluated_queries"] == 1
    assert report["recall_at_k"] == 1.0
    assert report["mrr_at_k"] == 1.0
    assert report["ndcg_at_k"] == 1.0

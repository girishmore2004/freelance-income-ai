from app.services.chunking import chunk_text
from app.services.retrieval import cosine_vectors, rank_chunks

def test_chunk_text_has_overlap_and_no_empty_chunks():
    text = " ".join(["portfolio evidence"] * 180)
    chunks = chunk_text(text, max_chars=250, overlap=40)
    assert len(chunks) > 1
    assert all(chunks)
    assert chunks[0][-20:] in chunks[1]

def test_vector_cosine_similarity():
    assert cosine_vectors([1, 0], [1, 0]) == 1
    assert cosine_vectors([1, 0], [0, 1]) == 0
    assert cosine_vectors([1], [1, 2]) == 0

def test_rank_chunks_uses_embeddings_when_available():
    docs = [
        {"id":"a","content":"not related","embedding":[0,1]},
        {"id":"b","content":"some other words","embedding":[1,0]},
    ]
    ranked = rank_chunks("irrelevant lexical query", [1,0], docs)
    assert ranked[0]["id"] == "b"
    assert ranked[0]["retrieval_method"] == "embedding_cosine"

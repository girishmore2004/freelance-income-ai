from app.services.retrieval import cosine_text_similarity,rank_documents
def test_similarity_relevance():
 assert cosine_text_similarity("Python FastAPI RAG","Build a RAG API using Python and FastAPI") > cosine_text_similarity("Python FastAPI RAG","Gardening and recipes")
def test_rank_documents():
 docs=[{"id":"a","extracted_text":"flowers garden"},{"id":"b","extracted_text":"Python FastAPI retrieval augmented generation"}]
 assert rank_documents("Python FastAPI RAG",docs)[0]["id"]=="b"

# Release 2.3 — Hybrid RAG and Retrieval Quality

## Purpose

Improve portfolio and business-coach retrieval while preserving the existing FastAPI, SQLAlchemy, PostgreSQL/pgvector, Next.js and provider setup.

## Changes

- Hybrid retrieval combines lexical cosine and embedding cosine using weighted reciprocal-rank fusion (RRF), rather than selecting only one modality.
- Retrieval gracefully falls back to lexical search when embeddings are unavailable or absent.
- Maximal marginal relevance (MMR) provides a diversity-aware ordering of the retrieved candidate set.
- Results expose lexical score, semantic score, modality ranks, fused similarity and retrieval method for inspection.
- The business coach now attempts a bounded query embedding (5-second timeout) before portfolio retrieval; failure falls back to lexical search.
- Coach responses include citation-ID validation against the exact retrieved source IDs. This checks citation references, not the truth of every generated sentence.
- Offline evaluation reports hit rate, precision@K, recall@K, MRR@K and nDCG@K.

## Configuration

No new environment variables or database migration are required. Existing embedding provider settings are reused. The configured embedding provider must produce vectors with the same dimensions as stored chunk embeddings; mismatched vectors safely fall back to lexical ranking for affected items.

## Limitations

- RRF and MMR are deterministic ranking techniques, not a learned reranker.
- Lexical cosine is not BM25; no external search service is required.
- The evaluation metrics are only meaningful when the user supplies a representative, labeled relevance dataset.
- Citation-ID validation cannot prove semantic entailment or guarantee factual correctness.
- No autonomous external action is introduced.

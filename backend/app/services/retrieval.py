"""Deterministic lexical, vector and hybrid retrieval helpers."""
import math
import re
from collections import Counter


def tokenize(text: str) -> list[str]:
    return re.findall(r"[a-zA-Z0-9+#.]{2,}", (text or "").lower())


def cosine_text_similarity(query: str, document: str) -> float:
    a, b = Counter(tokenize(query)), Counter(tokenize(document))
    if not a or not b:
        return 0.0
    common = set(a) & set(b)
    dot = sum(a[t] * b[t] for t in common)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0


def cosine_vectors(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def rank_documents(query: str, documents: list[dict], limit: int = 5) -> list[dict]:
    ranked = []
    for item in documents:
        score = cosine_text_similarity(query, item.get("extracted_text", ""))
        if score > 0:
            ranked.append({**item, "similarity": round(score, 4), "retrieval_method": "lexical_cosine"})
    return sorted(ranked, key=lambda x: x["similarity"], reverse=True)[:max(0, limit)]


def _rank_map(items: list[tuple[str, float]]) -> dict[str, int]:
    return {item_id: index + 1 for index, (item_id, _) in enumerate(
        sorted(items, key=lambda pair: pair[1], reverse=True) if items else [])}


def _mmr_select(candidates: list[dict], query: str, limit: int, diversity: float) -> list[dict]:
    """Maximal marginal relevance using lexical overlap as a cheap diversity signal."""
    selected: list[dict] = []
    remaining = list(candidates)
    while remaining and len(selected) < max(0, limit):
        best, best_score = None, float("-inf")
        for candidate in remaining:
            relevance = float(candidate.get("similarity", 0.0))
            redundancy = max(
                (cosine_text_similarity(candidate.get("content", ""), item.get("content", ""))
                 for item in selected), default=0.0
            )
            score = (1.0 - diversity) * relevance - diversity * redundancy
            if score > best_score:
                best, best_score = candidate, score
        if best is None:
            break
        best = {**best, "mmr_score": round(best_score, 6)}
        selected.append(best)
        remaining.remove(next(x for x in remaining if x.get("id") == best.get("id")))
    return selected


def rank_chunks(
    query: str,
    query_embedding: list[float] | None,
    chunks: list[dict],
    limit: int = 6,
    *,
    lexical_weight: float = 0.35,
    semantic_weight: float = 0.65,
    diversity: float = 0.12,
) -> list[dict]:
    """Hybrid retrieval using reciprocal-rank fusion and optional MMR diversification.

    When either modality is unavailable, the available modality remains usable. RRF
    avoids comparing incomparable raw lexical/vector score scales.
    """
    if limit <= 0 or not chunks:
        return []
    lexical = []
    semantic = []
    by_id = {}
    for index, item in enumerate(chunks):
        item_id = str(item.get("id", f"row-{index}"))
        by_id[item_id] = item
        lexical_score = cosine_text_similarity(query, item.get("content", ""))
        if lexical_score > 0:
            lexical.append((item_id, lexical_score))
        embedding = item.get("embedding") or []
        if query_embedding and embedding:
            semantic_score = cosine_vectors(query_embedding, embedding)
            if semantic_score > 0:
                semantic.append((item_id, semantic_score))

    use_semantic = bool(query_embedding and semantic)
    use_lexical = bool(lexical)
    if not use_lexical and not use_semantic:
        return []
    lw = max(0.0, lexical_weight) if use_lexical else 0.0
    sw = max(0.0, semantic_weight) if use_semantic else 0.0
    total_weight = lw + sw
    if total_weight <= 0:
        lw, sw = (1.0, 0.0) if use_lexical else (0.0, 1.0)
        total_weight = 1.0
    lw, sw = lw / total_weight, sw / total_weight
    lexical_ranks, semantic_ranks = _rank_map(lexical), _rank_map(semantic)
    lexical_scores, semantic_scores = dict(lexical), dict(semantic)
    # Weighted reciprocal-rank fusion; rank constant reduces sensitivity to corpus size.
    rrf_constant = 60.0
    candidates = []
    for item_id, item in by_id.items():
        lr, sr = lexical_ranks.get(item_id), semantic_ranks.get(item_id)
        if lr is None and sr is None:
            continue
        fused = (lw / (rrf_constant + lr) if lr else 0.0) + (sw / (rrf_constant + sr) if sr else 0.0)
        candidates.append({
            **item,
            "similarity": round(fused * (rrf_constant + 1), 6),
            "lexical_score": round(lexical_scores.get(item_id, 0.0), 5),
            "semantic_score": round(max(0.0, semantic_scores.get(item_id, 0.0)), 5),
            "lexical_rank": lr,
            "semantic_rank": sr,
            "retrieval_method": "hybrid_rrf" if use_lexical and use_semantic else ("lexical_cosine" if use_lexical else "embedding_cosine"),
        })
    candidates.sort(key=lambda x: x["similarity"], reverse=True)
    # MMR only reorders the candidate pool; it never adds unsupported documents.
    pool = candidates[:max(limit, min(len(candidates), limit * 4))]
    return _mmr_select(pool, query, limit, min(0.5, max(0.0, diversity)))

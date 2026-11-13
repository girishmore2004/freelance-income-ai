"""Portfolio-grounded proposal context.

This module deterministically selects user-owned evidence and reports provenance.
It does not claim retrieved text independently proves a fact.
"""
from __future__ import annotations

from typing import Any

from .retrieval import rank_chunks, tokenize


def build_proposal_query(opportunity: dict[str, Any]) -> str:
    parts = [
        opportunity.get("title", ""),
        opportunity.get("description", ""),
        " ".join(opportunity.get("required_skills") or []),
        opportunity.get("industry", ""),
    ]
    return " ".join(str(part) for part in parts if part).strip()[:6000]


def select_portfolio_evidence(
    query: str,
    chunks: list[dict[str, Any]],
    query_embedding: list[float] | None = None,
    *, limit: int = 6, min_score: float = 0.015,
) -> dict[str, Any]:
    """Rank only supplied (already tenant-scoped) portfolio chunks."""
    candidates = rank_chunks(query, query_embedding, chunks, limit=max(0, min(limit, 10)))
    selected = []
    for item in candidates:
        score = float(item.get("similarity") or 0.0)
        if score < min_score:
            continue
        selected.append({
            "chunk_id": str(item.get("id", "")),
            "document_id": str(item.get("document_id", "")),
            "chunk_index": int(item.get("chunk_index", 0)),
            "content": str(item.get("content", ""))[:1800],
            "similarity": round(score, 5),
            "retrieval_method": item.get("retrieval_method", "unknown"),
        })

    query_terms = set(tokenize(query))
    evidence_terms = set(tokenize(" ".join(x["content"] for x in selected)))
    coverage = round(len(query_terms & evidence_terms) / max(1, len(query_terms)), 3)
    if not selected:
        level = "none"
    elif coverage >= 0.30 and len(selected) >= 2:
        level = "good"
    elif coverage >= 0.12:
        level = "partial"
    else:
        level = "limited"
    return {
        "evidence": selected,
        "evidence_count": len(selected),
        "coverage_score": coverage,
        "coverage_level": level,
        "retrieval_mode": (
            "hybrid" if any(x["retrieval_method"] == "hybrid_rrf" for x in selected)
            else (selected[0]["retrieval_method"] if selected else "no_match")
        ),
        "limitations": [
            "Retrieved portfolio material is user-provided and has not been independently verified.",
            "Similarity is a retrieval signal, not proof that a project satisfies every job requirement.",
            "Review every experience, metric and result claim before approving a proposal.",
        ],
    }


def format_evidence_for_prompt(evidence: dict[str, Any]) -> str:
    rows = evidence.get("evidence") or []
    if not rows:
        return "No relevant portfolio document evidence was retrieved. Do not claim specific past projects, client outcomes, metrics, certifications or case studies."
    return "\n".join(
        f"[Evidence {i + 1}; document_id={row['document_id']}; chunk_id={row['chunk_id']}]\n{row['content']}"
        for i, row in enumerate(rows)
    )

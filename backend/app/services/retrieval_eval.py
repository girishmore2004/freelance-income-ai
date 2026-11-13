"""Deterministic offline retrieval metrics for curated relevance datasets.

Metrics measure ranking against labelled chunk IDs; they do not prove answer
correctness or semantic relevance beyond the quality of human labels.
"""
import math
from .retrieval import rank_chunks


def validate_retrieval_dataset(payload):
    errors = []
    if not isinstance(payload, dict):
        return ["Dataset root must be a JSON object."]
    cases = payload.get("cases")
    if not isinstance(cases, list) or not cases:
        return ["cases must be a non-empty array."]
    seen = set()
    for index, case in enumerate(cases):
        prefix = f"cases[{index}]"
        if not isinstance(case, dict):
            errors.append(f"{prefix} must be an object.")
            continue
        case_id = str(case.get("case_id", "")).strip()
        if not case_id:
            errors.append(f"{prefix}.case_id is required.")
        elif case_id in seen:
            errors.append(f"Duplicate case_id: {case_id}.")
        seen.add(case_id)
        if not str(case.get("query", "")).strip():
            errors.append(f"{prefix}.query must be non-empty.")
        chunks = case.get("chunks")
        if not isinstance(chunks, list) or not chunks:
            errors.append(f"{prefix}.chunks must be a non-empty array.")
            continue
        chunk_ids = []
        for chunk_index, chunk in enumerate(chunks):
            if not isinstance(chunk, dict):
                errors.append(f"{prefix}.chunks[{chunk_index}] must be an object.")
                continue
            chunk_id = str(chunk.get("id", "")).strip()
            if not chunk_id:
                errors.append(f"{prefix}.chunks[{chunk_index}].id is required.")
            chunk_ids.append(chunk_id)
            if not str(chunk.get("content", "")).strip():
                errors.append(f"{prefix}.chunks[{chunk_index}].content is required.")
        if len(chunk_ids) != len(set(chunk_ids)):
            errors.append(f"{prefix} contains duplicate chunk IDs.")
        relevant = case.get("relevant_chunk_ids")
        if not isinstance(relevant, list) or not relevant:
            errors.append(f"{prefix}.relevant_chunk_ids must be a non-empty array.")
        elif len(relevant) != len(set(map(str, relevant))):
            errors.append(f"{prefix}.relevant_chunk_ids contains duplicates.")
        elif set(map(str, relevant)) - set(chunk_ids):
            errors.append(f"{prefix}.relevant_chunk_ids references chunks not present in the case.")
    return errors


def evaluate_retrieval(cases: list[dict], limit: int = 5) -> dict:
    if not isinstance(limit, int) or isinstance(limit, bool) or limit < 1 or limit > 100:
        raise ValueError("limit must be an integer between 1 and 100")
    reciprocal_ranks, ndcgs, precisions, returned_precisions, recalls = [], [], [], [], []
    hit_count = total = 0
    details = []
    for case in cases:
        expected = set(map(str, case.get("relevant_chunk_ids", [])))
        if not expected:
            continue
        ranked = rank_chunks(case["query"], case.get("query_embedding"), case["chunks"], limit, diversity=0)
        ids = [str(item["id"]) for item in ranked]
        hits = sum(item_id in expected for item_id in ids)
        total += 1
        hit_count += int(hits > 0)
        precision = hits / limit
        returned_precision = hits / max(1, len(ids))
        recall = hits / len(expected)
        rank = next((i + 1 for i, item_id in enumerate(ids) if item_id in expected), None)
        reciprocal = 1.0 / rank if rank else 0.0
        dcg = sum((1.0 / math.log2(i + 2)) for i, item_id in enumerate(ids) if item_id in expected)
        ideal_hits = min(len(expected), limit)
        idcg = sum(1.0 / math.log2(i + 2) for i in range(ideal_hits))
        ndcg = dcg / idcg if idcg else 0.0
        precisions.append(precision)
        returned_precisions.append(returned_precision)
        recalls.append(recall)
        reciprocal_ranks.append(reciprocal)
        ndcgs.append(ndcg)
        details.append({
            "case_id": case.get("case_id", "unknown"),
            "retrieved_chunk_ids": ids,
            "relevant_chunk_ids": sorted(expected),
            "first_relevant_rank": rank,
            "hit": bool(hits),
            "precision_at_k": round(precision, 4),
            "precision_among_returned": round(returned_precision, 4),
            "returned_count": len(ids),
            "recall_at_k": round(recall, 4),
            "reciprocal_rank": round(reciprocal, 4),
            "ndcg_at_k": round(ndcg, 4),
        })
    return {
        "evaluated_queries": total,
        "hit_rate_at_k": round(hit_count / total, 4) if total else 0.0,
        "precision_at_k": round(sum(precisions) / total, 4) if total else 0.0,
        "precision_among_returned": round(sum(returned_precisions) / total, 4) if total else 0.0,
        "recall_at_k": round(sum(recalls) / total, 4) if total else 0.0,
        "mrr_at_k": round(sum(reciprocal_ranks) / total, 4) if total else 0.0,
        "ndcg_at_k": round(sum(ndcgs) / total, 4) if total else 0.0,
        "k": limit,
        "metric_scope": "Ranking metrics against supplied relevant chunk IDs; label quality determines validity.",
        "details": details,
    }

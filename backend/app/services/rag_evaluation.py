"""Offline RAG evidence and claim-grounding evaluation.

Citation ID overlap is exact. Claim support is a deterministic lexical proxy with
numeric and negation conflict checks; it is not a semantic entailment model.
"""
import re

_STOP = {
    "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "with",
    "from", "by", "as", "at", "is", "are", "was", "were", "be", "been",
    "has", "have", "had", "this", "that", "it", "i", "we", "our", "my",
    "their", "they", "he", "she", "you", "your", "can", "will", "would",
    "could", "should", "do", "does", "did", "using", "used",
}
_NEGATIONS = {"not", "never", "no", "without", "cannot", "can't", "didn't", "doesn't", "isn't", "wasn't", "exclude", "excludes", "excluded", "lacking"}


def _normalize_scope_language(text):
    value = (text or "").lower()
    value = re.sub(r"\b(?:does not include|doesn't include|did not include|didn't include)\b", "not include", value)
    value = re.sub(r"\b(?:excludes|exclude|excluded|without)\b", "not include", value)
    return value


def _tokens(text):
    normalized = _normalize_scope_language(text)
    return set(re.findall(r"[a-z][a-z0-9+#.-]*|\d+(?:\.\d+)?", normalized)) - _STOP


def _numbers(text):
    return set(re.findall(r"\d+(?:\.\d+)?", text or ""))


def _negated(text):
    lower = (text or "").lower()
    return any(re.search(r"\b" + re.escape(term) + r"\b", lower) for term in _NEGATIONS)


def assess_claim_support(claim, evidence_texts, min_coverage=0.6):
    """Return a transparent lexical support estimate and conflict flags."""
    claim_tokens = _tokens(claim)
    evidence = "\n".join(str(x or "") for x in (evidence_texts or []))
    evidence_tokens = _tokens(evidence)
    coverage = len(claim_tokens & evidence_tokens) / len(claim_tokens) if claim_tokens else 0.0
    claim_numbers, evidence_numbers = _numbers(claim), _numbers(evidence)
    numeric_conflict = bool(claim_numbers and not claim_numbers.issubset(evidence_numbers))
    negation_conflict = bool(claim_tokens and _negated(claim) != _negated(evidence))
    supported = bool(claim_tokens) and coverage >= min_coverage and not numeric_conflict and not negation_conflict
    return {
        "supported": supported,
        "token_coverage": round(coverage, 4),
        "numeric_conflict": numeric_conflict,
        "negation_conflict": negation_conflict,
        "claim_token_count": len(claim_tokens),
        "matched_token_count": len(claim_tokens & evidence_tokens),
        "metric_scope": "Lexical overlap proxy with number/negation conflict flags; not semantic entailment.",
    }


def citation_metrics(expected_ids, cited_ids, available_ids=None):
    expected = {str(value) for value in (expected_ids or []) if value is not None}
    cited = {str(value) for value in (cited_ids or []) if value is not None}
    available = ({str(value) for value in available_ids if value is not None}
                 if available_ids is not None else None)
    unknown = sorted(cited - available) if available is not None else []
    true_positive = len(expected & cited)
    precision = true_positive / len(cited) if cited else (1.0 if not expected else 0.0)
    recall = true_positive / len(expected) if expected else (1.0 if not cited else 0.0)
    f1 = (2 * precision * recall / (precision + recall)) if precision + recall else 0.0
    return {
        "expected_count": len(expected), "cited_count": len(cited),
        "matched_count": true_positive,
        "precision": round(precision, 4), "recall": round(recall, 4),
        "f1": round(f1, 4),
        "unknown_citation_count": len(unknown),
        "unknown_citation_ids": unknown,
        "citation_integrity": ("invalid" if unknown else "valid") if available is not None else "not_checked",
        "metric_scope": "Evidence-ID overlap only; not semantic grounding or factual correctness.",
    }


def evaluate_grounding_cases(cases, min_coverage=0.6):
    """Evaluate human-labelled claims; evidence is supplied per claim as {id,text}."""
    tp = fp = tn = fn = total = 0
    coverage_values = []
    details = []
    for case in cases:
        for item in case.get("claims", []):
            evidence = item.get("evidence", [])
            evidence_by_id = {str(x.get("id")): x.get("text", "") for x in evidence}
            cited_ids = [str(x) for x in item.get("cited_evidence_ids", [])]
            unknown_citations = sorted(set(cited_ids) - set(evidence_by_id))
            cited_texts = [evidence_by_id[x] for x in cited_ids if x in evidence_by_id]
            result = assess_claim_support(item.get("claim", ""), cited_texts, min_coverage)
            result["unknown_citation_ids"] = unknown_citations
            result["citation_integrity"] = "invalid" if unknown_citations else "valid"
            if unknown_citations:
                result["supported"] = False
            expected = bool(item.get("expected_supported", False))
            predicted = result["supported"]
            tp += int(expected and predicted)
            fp += int(not expected and predicted)
            tn += int(not expected and not predicted)
            fn += int(expected and not predicted)
            total += 1
            coverage_values.append(result["token_coverage"])
            details.append({
                "case_id": case.get("case_id", "unknown"),
                "claim": item.get("claim", ""),
                "expected_supported": expected,
                **result,
            })
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    return {
        "evaluated_claims": total,
        "true_positive": tp, "false_positive": fp,
        "true_negative": tn, "false_negative": fn,
        "precision": round(precision, 4), "recall": round(recall, 4),
        "f1": round(2 * precision * recall / (precision + recall), 4) if precision + recall else 0.0,
        "mean_token_coverage": round(sum(coverage_values) / len(coverage_values), 4) if coverage_values else 0.0,
        "threshold": min_coverage,
        "unknown_citation_count": sum(len(x.get("unknown_citation_ids", [])) for x in details),
        "citation_integrity_pass": not any(x.get("unknown_citation_ids") for x in details),
        "metric_scope": "Human-labelled fixture evaluation using lexical proxy; not semantic entailment.",
        "details": details,
    }


def validate_grounding_dataset(payload):
    """Validate benchmark structure without treating synthetic labels as production truth."""
    errors = []
    if not isinstance(payload, dict):
        return ["Dataset root must be a JSON object."]
    review_status = payload.get("review_status", "synthetic_or_unreviewed")
    if review_status not in {"synthetic", "unreviewed", "human_reviewed", "synthetic_or_unreviewed"}:
        errors.append("review_status must be synthetic, unreviewed, or human_reviewed.")
    if review_status == "human_reviewed":
        review = payload.get("review")
        if not isinstance(review, dict) or not all(str(review.get(key, "")).strip() for key in ("reviewed_by", "reviewed_at", "method")):
            errors.append("Human-reviewed datasets require review.reviewed_by, review.reviewed_at, and review.method.")
    cases = payload.get("cases")
    if not isinstance(cases, list) or not cases:
        errors.append("cases must be a non-empty array.")
        return errors
    case_ids = set()
    for case_index, case in enumerate(cases):
        if not isinstance(case, dict):
            errors.append(f"cases[{case_index}] must be an object.")
            continue
        case_id = str(case.get("case_id", "")).strip()
        if not case_id:
            errors.append(f"cases[{case_index}] is missing case_id.")
        elif case_id in case_ids:
            errors.append(f"Duplicate case_id: {case_id}.")
        case_ids.add(case_id)
        claims = case.get("claims")
        if not isinstance(claims, list) or not claims:
            errors.append(f"{case_id or case_index}: claims must be a non-empty array.")
            continue
        for claim_index, item in enumerate(claims):
            prefix = f"{case_id or case_index}.claims[{claim_index}]"
            if not isinstance(item, dict):
                errors.append(f"{prefix} must be an object.")
                continue
            if not str(item.get("claim", "")).strip():
                errors.append(f"{prefix} is missing claim text.")
            if not isinstance(item.get("expected_supported"), bool):
                errors.append(f"{prefix}.expected_supported must be boolean.")
            evidence = item.get("evidence")
            if not isinstance(evidence, list) or not evidence:
                errors.append(f"{prefix}.evidence must be a non-empty array.")
                continue
            ids = set()
            for evidence_index, record in enumerate(evidence):
                if not isinstance(record, dict):
                    errors.append(f"{prefix}.evidence[{evidence_index}] must be an object.")
                    continue
                evidence_id = str(record.get("id", "")).strip()
                if not evidence_id:
                    errors.append(f"{prefix}.evidence[{evidence_index}] is missing id.")
                elif evidence_id in ids:
                    errors.append(f"{prefix} has duplicate evidence id {evidence_id}.")
                ids.add(evidence_id)
                if not str(record.get("text", "")).strip():
                    errors.append(f"{prefix}.evidence[{evidence_index}] is missing text.")
            cited = item.get("cited_evidence_ids", [])
            if not isinstance(cited, list):
                errors.append(f"{prefix}.cited_evidence_ids must be an array.")
            elif set(map(str, cited)) - ids:
                errors.append(f"{prefix} cites evidence IDs not present in its evidence array.")
    return errors

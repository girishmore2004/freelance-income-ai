"""Deterministic review flags for factual claims in generated proposals.

This is a conservative review aid, not a truth detector. It never auto-approves,
rejects, or edits a proposal; every flagged statement requires human review.
"""
from __future__ import annotations

import re
from typing import Any

_PATTERNS = [
    ("experience_duration", re.compile(r"\b\d{1,2}\+?\s*(?:years?|yrs?)\s+(?:of\s+)?experience\b", re.I)),
    ("quantified_result", re.compile(r"\b(?:increased|improved|reduced|saved|grew|generated|processed|achieved|delivered)\b[^.!?\n]{0,100}?\b\d+(?:\.\d+)?\s*(?:%|percent\b|x\b|hours?\b|days?\b|users?\b|customers?\b|projects?\b|\$|₹|USD\b|INR\b)", re.I)),
    ("credential", re.compile(r"\b(?:certified|certification|licensed|degree in|master'?s degree|bachelor'?s degree)\b[^.!?\n]{0,100}", re.I)),
    ("named_client_or_employer", re.compile(r"\b(?:worked with|built for|client(?:s)? include|at)\s+[A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,3}")),
    ("specific_delivery_claim", re.compile(r"\b(?:I have|I've)\s+(?:built|developed|deployed|implemented|delivered|managed|led)\b[^.!?\n]{0,140}", re.I)),
]


def validate_proposal_claims(content: str, evidence: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return candidate factual claims and conservative evidence-overlap flags."""
    text = str(content or "")
    sources = [str(x.get("content", "")) for x in (evidence or {}).get("evidence", [])]
    source_text = " ".join(sources).casefold()
    findings: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for category, pattern in _PATTERNS:
        for match in pattern.finditer(text):
            claim = re.sub(r"\s+", " ", match.group(0)).strip()
            key = (category, claim.casefold())
            if key in seen:
                continue
            seen.add(key)
            terms = [t for t in re.findall(r"[a-zA-Z0-9₹$%]+", claim.casefold()) if len(t) > 2]
            overlap = sum(1 for term in set(terms) if term in source_text)
            ratio = overlap / max(1, len(set(terms)))
            findings.append({
                "category": category,
                "claim": claim[:240],
                "evidence_overlap": round(ratio, 3),
                "status": "possible_support" if ratio >= 0.6 else "needs_manual_verification",
                "reason": "Text overlap is only a retrieval hint; confirm the original source and exact wording." if ratio >= 0.6 else "No strong lexical support found in retrieved portfolio excerpts; verify or remove before sending.",
            })
    needs_review = bool(findings)
    return {
        "status": "review_required" if needs_review else "no_high_risk_pattern_detected",
        "finding_count": len(findings),
        "findings": findings,
        "limitations": [
            "This heuristic can miss unsupported claims and can flag valid claims.",
            "Text overlap does not establish truth, ownership, permission, or context.",
            "Review the full original portfolio source and profile before requesting approval or sending.",
        ],
    }

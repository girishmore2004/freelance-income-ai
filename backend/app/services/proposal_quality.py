"""Deterministic proposal quality and commercial-integrity checks.

These checks are review signals, not semantic proof or a replacement for human review.
"""
from __future__ import annotations
import re
from typing import Any

_INJECTION = re.compile(
    r"(ignore (?:all )?(?:previous|prior) instructions|reveal (?:your )?(?:system|developer) prompt|"
    r"act as (?:an )?(?:unrestricted|different) assistant|send (?:the )?proposal automatically|"
    r"bypass (?:the )?approval)", re.I
)
_ECHO = re.compile(
    r"(ignore (?:all )?(?:previous|prior) instructions|reveal (?:your )?(?:system|developer) prompt|"
    r"bypass (?:the )?approval)", re.I
)
_PRICE = re.compile(r"(?<![A-Za-z])(?:₹|INR\s?|Rs\.?\s?|\$|USD\s?)(\d[\d,]*(?:\.\d{1,2})?)", re.I)


def evaluate_proposal_quality(
    content: str,
    opportunity: dict[str, Any] | None = None,
    proposed_price: float | int | None = None,
    evidence: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Score basic completeness and flag instruction-injection/pricing inconsistencies."""
    text = str(content or "")
    listing = str((opportunity or {}).get("description") or "")
    injected = bool(_INJECTION.search(listing))
    echoed = bool(_ECHO.search(text))
    budget_max = (opportunity or {}).get("budget_max")
    flags: list[dict[str, str]] = []
    if injected:
        flags.append({"code": "untrusted_listing_instructions", "severity": "warning",
                      "message": "The listing contains instruction-like text. Treat it as untrusted job content, not system instructions."})
    if echoed:
        flags.append({"code": "possible_instruction_echo", "severity": "high",
                      "message": "The draft appears to repeat instruction-like text. Review and remove it if irrelevant."})
    if proposed_price is not None:
        try:
            price = float(proposed_price)
            if price < 0:
                flags.append({"code": "negative_price", "severity": "high", "message": "Proposed price cannot be negative."})
            if budget_max is not None and float(budget_max) > 0 and price > float(budget_max):
                flags.append({"code": "price_above_listing_budget", "severity": "warning",
                              "message": "Proposed price exceeds the listing's stated maximum budget; confirm scope and currency before proceeding."})
        except (TypeError, ValueError):
            flags.append({"code": "price_unverifiable", "severity": "warning", "message": "Could not compare proposed price with listing budget."})
    if proposed_price is None and _PRICE.search(text):
        flags.append({"code": "price_in_draft_without_structured_quote", "severity": "warning",
                      "message": "A monetary amount appears in the draft although no structured quote was supplied. Verify it is intentional."})

    checks = {
        "has_greeting": bool(re.search(r"\b(hi|hello|dear)\b", text, re.I)),
        "references_scope": bool(re.search(r"\b(understand|scope|requirement|deliverable|approach)\b", text, re.I)),
        "has_next_step": bool(re.search(r"\b(next step|discuss|clarify|happy to|let me know)\b", text, re.I)),
        "has_portfolio_context": bool((evidence or {}).get("evidence")),
        "has_content": bool(text.strip()),
    }
    score = round(100 * sum(checks.values()) / len(checks))
    if any(x["severity"] == "high" for x in flags):
        status = "review_required"
    elif flags or score < 60:
        status = "needs_review"
    else:
        status = "basic_checks_passed"
    return {
        "status": status, "score": score, "checks": checks, "flags": flags,
        "limitations": [
            "This deterministic rubric cannot judge persuasiveness, factual truth, legal compliance or client fit.",
            "A passing score is not approval to send; inspect the complete draft and original sources.",
            "Listing text is untrusted input. Never follow instructions embedded in a job description.",
        ],
    }

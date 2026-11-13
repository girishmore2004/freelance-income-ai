"""Outcome intelligence from user-owned proposals and manually recorded feedback."""
from __future__ import annotations
from collections import defaultdict
from typing import Any
from .proposal_quality import evaluate_proposal_quality

DECIDED_WINS = {"won"}
DECIDED_NON_WINS = {"lost", "rejected"}
UNKNOWN_OUTCOMES = {"no_response", "not_relevant", "client_risk"}
MIN_DECIDED_SAMPLE = 5


def _latest_by_opportunity(rows: list[Any], key_name: str = "created_at") -> dict[str, Any]:
    latest: dict[str, Any] = {}
    for row in rows:
        opportunity_id = getattr(row, "opportunity_id", None)
        if not opportunity_id:
            continue
        current = latest.get(opportunity_id)
        stamp = getattr(row, key_name, None)
        current_stamp = getattr(current, key_name, None) if current else None
        if current is None or (stamp is not None and (current_stamp is None or stamp >= current_stamp)):
            latest[opportunity_id] = row
    return latest


def build_proposal_outcome_intelligence(
    opportunities: list[Any], proposals: list[Any], feedback: list[Any],
    minimum_sample: int = MIN_DECIDED_SAMPLE,
) -> dict[str, Any]:
    """Join latest proposal and latest feedback per opportunity; keep unknowns out of win-rate denominator."""
    if minimum_sample < 2:
        raise ValueError("minimum_sample must be at least 2")
    opportunity_by_id = {row.id: row for row in opportunities}
    latest_proposals = _latest_by_opportunity(proposals)
    latest_feedback = _latest_by_opportunity(feedback)
    groups: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "opportunities": 0, "proposals": 0, "wins": 0, "losses": 0,
        "unknown": 0, "quality_score_total": 0, "quality_score_count": 0,
        "quality_bands": defaultdict(lambda: {"count": 0, "wins": 0, "losses": 0, "unknown": 0}),
    })
    outcome_counts: dict[str, int] = defaultdict(int)
    matched = 0
    for opportunity_id, opportunity in opportunity_by_id.items():
        proposal = latest_proposals.get(opportunity_id)
        feedback_row = latest_feedback.get(opportunity_id)
        if proposal is None:
            continue
        matched += 1
        source = (getattr(opportunity, "source", None) or "unknown").strip().lower() or "unknown"
        bucket = groups[source]
        bucket["opportunities"] += 1
        bucket["proposals"] += 1
        outcome = getattr(feedback_row, "outcome", "undecided") if feedback_row else "undecided"
        outcome_counts[outcome] += 1
        if outcome in DECIDED_WINS:
            bucket["wins"] += 1
        elif outcome in DECIDED_NON_WINS:
            bucket["losses"] += 1
        elif outcome in UNKNOWN_OUTCOMES or outcome == "undecided":
            bucket["unknown"] += 1

        quality = evaluate_proposal_quality(
            getattr(proposal, "content", "") or "",
            {"description": getattr(opportunity, "description", ""),
             "budget_max": getattr(opportunity, "budget_max", None)},
            getattr(proposal, "proposed_price", None),
        )
        score = quality["score"]
        band = "strong_basic_checks" if score >= 80 else ("mixed_basic_checks" if score >= 60 else "needs_attention")
        bucket["quality_score_total"] += score
        bucket["quality_score_count"] += 1
        q = bucket["quality_bands"][band]
        q["count"] += 1
        if outcome in DECIDED_WINS:
            q["wins"] += 1
        elif outcome in DECIDED_NON_WINS:
            q["losses"] += 1
        else:
            q["unknown"] += 1

    sources = []
    for source, row in sorted(groups.items()):
        decided = row["wins"] + row["losses"]
        enough = decided >= minimum_sample
        sources.append({
            "source": source, "proposals": row["proposals"],
            "wins": row["wins"], "losses": row["losses"],
            "unknown_or_undecided": row["unknown"], "decided_sample_size": decided,
            "win_rate_percent": round(100 * row["wins"] / decided, 1) if enough and decided else None,
            "descriptive_win_rate_percent": round(100 * row["wins"] / decided, 1) if decided else None,
            "minimum_sample_met": enough,
            "average_basic_quality_score": round(row["quality_score_total"] / row["quality_score_count"], 1) if row["quality_score_count"] else None,
            "quality_bands": [
                {"band": band, **values,
                 "decided_sample_size": values["wins"] + values["losses"],
                 "win_rate_percent": round(100 * values["wins"] / (values["wins"] + values["losses"]), 1)
                     if values["wins"] + values["losses"] >= minimum_sample else None}
                for band, values in sorted(row["quality_bands"].items())
            ],
        })
    return {
        "sources": sources,
        "proposal_records_with_opportunity": matched,
        "outcomes": dict(sorted(outcome_counts.items())),
        "minimum_decided_sample": minimum_sample,
        "method": "Latest proposal and latest manually recorded feedback per opportunity; latest chosen by created_at.",
        "limitations": [
            "Association is not causation. Source and basic quality scores do not establish why a client won or declined.",
            "Basic quality score is a deterministic completeness/safety heuristic, not semantic proposal quality or factual verification.",
            "Unknown, no-response and undecided records are excluded from the win-rate denominator.",
            "A win rate is withheld until the source or quality band has the configured minimum decided sample.",
            "Only saved user-owned opportunities, proposals and manually entered feedback are included; no marketplace outcomes are inferred.",
            "Currencies, pricing, project profitability and paid revenue are not combined in this analysis.",
        ],
    }

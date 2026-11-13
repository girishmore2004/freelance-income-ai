"""Evidence-gated freelance growth recommendations derived from recorded cohorts."""


def build_growth_recommendations(cohort_report, minimum_opportunities=5, minimum_decided=5):
    """Turn cohort metrics into cautious, explainable source actions.

    Does not predict earnings or compare currencies. Low-sample sources receive
    data-collection guidance rather than performance rankings.
    """
    windows = cohort_report.get("windows", {}) if isinstance(cohort_report, dict) else {}
    selected = windows.get("180") or windows.get("90") or {}
    rows = selected.get("sources", []) or []
    recommendations = []
    eligible = []
    for row in rows:
        source = str(row.get("source") or "unknown")
        leads = int(row.get("cohort_opportunities") or 0)
        proposals = int(row.get("with_proposal") or 0)
        submitted = int(row.get("submitted") or 0)
        decided = int(row.get("decided_outcomes") or 0)
        wins = int(row.get("wins") or 0)
        proposal_rate = row.get("proposal_conversion_percent")
        submission_rate = row.get("submission_conversion_percent")
        win_rate = row.get("win_rate_of_decided_percent")
        cash = row.get("net_recorded_cash_by_currency") or {}

        if leads < minimum_opportunities:
            recommendations.append({
                "source": source, "priority": "collect_more_data", "confidence": "low",
                "title": "Collect more evidence before changing source strategy",
                "action": f"Record at least {minimum_opportunities} opportunities from {source} before judging its performance.",
                "evidence": {"cohort_opportunities": leads, "minimum_opportunities": minimum_opportunities},
            })
            continue

        if proposal_rate is not None and proposal_rate < 50:
            recommendations.append({
                "source": source, "priority": "improve_proposal_coverage", "confidence": "moderate",
                "title": "Review lead qualification and proposal follow-through",
                "action": f"Review why fewer than half of the {leads} cohort leads from {source} received a proposal. Check fit, budget, and response time before increasing volume.",
                "evidence": {"cohort_opportunities": leads, "with_proposal": proposals, "proposal_conversion_percent": proposal_rate},
            })
        elif submission_rate is not None and submission_rate < 60:
            recommendations.append({
                "source": source, "priority": "improve_submission_followthrough", "confidence": "moderate",
                "title": "Improve proposal-to-submission follow-through",
                "action": f"Audit drafts and approval delays for {source}; only {submission_rate}% of cohort leads have a recorded submission.",
                "evidence": {"cohort_opportunities": leads, "submitted": submitted, "submission_conversion_percent": submission_rate},
            })

        if decided >= minimum_decided and win_rate is not None:
            eligible.append((win_rate, leads, source, wins, decided, cash))
            if win_rate >= 30:
                recommendations.append({
                    "source": source, "priority": "prioritize_tested_source", "confidence": "moderate",
                    "title": "Consider prioritizing this source in a controlled test",
                    "action": f"This source has a {win_rate}% recorded win rate across {decided} decided outcomes. Run a controlled test with a modest increase in effort, then compare results again after another cohort.",
                    "evidence": {"wins": wins, "decided_outcomes": decided, "win_rate_of_decided_percent": win_rate, "cohort_opportunities": leads},
                })
            else:
                recommendations.append({
                    "source": source, "priority": "review_source_fit", "confidence": "moderate",
                    "title": "Review source fit before investing more effort",
                    "action": f"The recorded win rate is {win_rate}% across {decided} decided outcomes. Review client fit, scope, budget and proposal quality before increasing acquisition effort.",
                    "evidence": {"wins": wins, "decided_outcomes": decided, "win_rate_of_decided_percent": win_rate, "cohort_opportunities": leads},
                })
        elif not any(item["source"] == source for item in recommendations):
            recommendations.append({
                "source": source, "priority": "collect_outcome_data", "confidence": "low",
                "title": "Record client outcomes to evaluate source quality",
                "action": f"There are {decided} decided outcomes from {source}; record wins and losses consistently before using win rate to rank it.",
                "evidence": {"decided_outcomes": decided, "minimum_decided": minimum_decided, "cohort_opportunities": leads},
            })

    eligible.sort(key=lambda item: (-item[0], -item[1], item[2]))
    return {
        "as_of": cohort_report.get("as_of"),
        "window_days": selected.get("window_days", 180),
        "minimum_opportunities": minimum_opportunities,
        "minimum_decided_outcomes": minimum_decided,
        "recommendations": recommendations,
        "tested_sources": [{"source": source, "win_rate_percent": rate, "decided_outcomes": decided,
                            "cohort_opportunities": leads, "wins": wins}
                           for rate, leads, source, wins, decided, _cash in eligible],
        "method": "Recommendations are deterministic rules over manually recorded same-opportunity cohort data. They are operational suggestions, not causal conclusions or earnings forecasts.",
        "limitations": [
            "Sources below the minimum opportunity sample are not performance-ranked.",
            "Win-rate guidance requires the minimum decided-outcome sample; no-response and undecided records are excluded.",
            "Recorded cash is not used to rank sources because currencies and project economics are not directly comparable.",
            "Recent cohorts may be immature and source performance can change over time.",
        ],
    }

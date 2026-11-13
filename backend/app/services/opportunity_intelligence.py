"""Profile-aware opportunity intelligence with transparent ranking and review state."""
from .opportunity_ranking import rank_opportunity
from ..scoring import score_opportunity
from .client_risk import assess_client_risk


def build_intelligence_record(opportunity, profile, feedback, review=None):
    score, breakdown = score_opportunity(profile or {}, opportunity or {})
    risk = assess_client_risk(opportunity or {}, [])
    ranking = rank_opportunity({**opportunity, "match_score": score}, feedback or [], risk_assessment=risk)
    notes = breakdown.get("notes", {})
    reasons = list(ranking.get("reasons", []))
    if risk.get("signals"):
        reasons.extend(f"Risk signal: {signal['title']} ({signal['severity']})" for signal in risk["signals"])
    if notes.get("matched_skills"):
        reasons.append("Matched skills: " + ", ".join(notes["matched_skills"][:12]))
    if notes.get("missing_skills"):
        reasons.append("Missing skills to verify: " + ", ".join(notes["missing_skills"][:12]))
    if notes.get("dealbreaker_matches"):
        reasons.append("Profile dealbreakers matched: " + ", ".join(notes["dealbreaker_matches"]))
    if notes.get("eligibility_warnings"):
        reasons.extend(notes["eligibility_warnings"])
    status = review.decision if review else "unreviewed"
    return {
        "opportunity": {**opportunity, "match_score": score, "score_breakdown": breakdown},
        "ranking": ranking,
        "client_risk": {
            "risk_score": risk["risk_score"],
            "risk_level": risk["risk_level"],
            "evidence_coverage": risk["evidence_coverage"],
            "signals": risk["signals"],
            "questions_to_ask": risk["questions_to_ask"],
            "limitations": risk["limitations"],
        },
        "profile_eligibility": {
            "eligible_by_profile_rules": notes.get("eligible_by_profile_rules", True),
            "manual_review_required": notes.get("manual_review_required", False),
            "warnings": notes.get("eligibility_warnings", []),
            "dealbreaker_matches": notes.get("dealbreaker_matches", []),
        },
        "explanation": reasons,
        "review": {
            "decision": status,
            "notes": review.notes if review else "",
            "next_action_date": review.next_action_date if review else "",
        },
        "provenance": {
            "source": opportunity.get("source"),
            "source_url": opportunity.get("source_url"),
            "source_origins": opportunity.get("source_origins") or [],
            "duplicate_count": opportunity.get("duplicate_count", 0),
            "first_seen_at": opportunity.get("first_seen_at"),
            "last_seen_at": opportunity.get("last_seen_at"),
        },
    }

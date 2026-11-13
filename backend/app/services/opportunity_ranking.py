"""Explainable opportunity ranking with conservative user-feedback calibration."""
from datetime import datetime, timezone
from math import exp


POSITIVE = {"won"}
NEGATIVE = {"lost", "rejected", "no_response", "not_relevant", "client_risk"}


def _age_days(value, now):
    if not value:
        return None
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return max(0.0, (now - value.astimezone(timezone.utc)).total_seconds() / 86400)


def _feedback_prior(opportunity, feedback):
    industry = str(opportunity.get("industry") or "").strip().lower()
    job_type = str(opportunity.get("job_type") or "").strip().lower()
    relevant = []
    for item in feedback:
        if item.get("outcome") not in POSITIVE | NEGATIVE:
            continue
        item_industry = str(item.get("industry") or "").strip().lower()
        item_type = str(item.get("job_type") or "").strip().lower()
        # Use the user's own outcomes in the same work category; unknown metadata
        # is not treated as a match.
        same_industry = bool(industry and item_industry == industry)
        same_work_type = bool(job_type and item_type == job_type)
        if same_industry or same_work_type:
            relevant.append(item["outcome"])
    wins = sum(x in POSITIVE for x in relevant)
    losses = sum(x in NEGATIVE for x in relevant)
    # Beta(2,2) prior avoids extreme conclusions from one or two outcomes.
    rate = (wins + 2) / (wins + losses + 4)
    confidence = min(1.0, len(relevant) / 10)
    return 50 + (rate * 100 - 50) * confidence, len(relevant)


def rank_opportunity(opportunity, feedback, now=None, risk_assessment=None):
    now = now or datetime.now(timezone.utc)
    age = _age_days(opportunity.get("published_at") or opportunity.get("last_seen_at") or opportunity.get("created_at"), now)
    freshness = 50 if age is None else round(100 * exp(-age / 21), 1)
    feedback_score, feedback_samples = _feedback_prior(opportunity, feedback)
    base = max(0, min(100, float(opportunity.get("match_score") or 0)))
    # Risk-aware ranking is additive and backwards-compatible. Without a risk
    # assessment, retain the v1 formula exactly. With one, reserve 5 points for
    # listing/evidence risk while proportionally reducing the other weights.
    if risk_assessment is None:
        components = {
            "profile_match": round(base * .70, 1),
            "freshness": round(freshness * .20, 1),
            "historical_feedback": round(feedback_score * .10, 1),
        }
        ranking_version = "v1"
        reasons = [
            f"Profile match contributes {components['profile_match']} of 70 possible points",
            f"Freshness contributes {components['freshness']} of 20 possible points",
            f"Your historical outcome signal contributes {components['historical_feedback']} of 10 possible points",
        ]
        risk_summary = None
    else:
        raw_risk = max(0.0, min(100.0, float(risk_assessment.get("risk_score") or 0)))
        coverage = max(0.0, min(100.0, float(risk_assessment.get("evidence_coverage") or 0)))
        # Sparse evidence must not be interpreted as proof of safety or guilt.
        confidence = min(1.0, coverage / 60.0)
        risk_quality = 50.0 + ((100.0 - raw_risk) - 50.0) * confidence
        components = {
            "profile_match": round(base * .65, 1),
            "freshness": round(freshness * .20, 1),
            "historical_feedback": round(feedback_score * .10, 1),
            "risk_quality": round(risk_quality * .05, 1),
        }
        ranking_version = "v2-risk-aware"
        risk_summary = {
            "risk_score": round(raw_risk, 1),
            "risk_level": risk_assessment.get("risk_level", "insufficient_data"),
            "evidence_coverage": round(coverage, 1),
            "confidence": round(confidence, 2),
        }
        reasons = [
            f"Profile match contributes {components['profile_match']} of 65 possible points",
            f"Freshness contributes {components['freshness']} of 20 possible points",
            f"Your historical outcome signal contributes {components['historical_feedback']} of 10 possible points",
            f"Risk quality contributes {components['risk_quality']} of 5 possible points; evidence confidence is {confidence:.0%}",
        ]
        if risk_summary["risk_level"] == "high":
            reasons.append("High-risk signals were detected; review the evidence before proceeding")
        elif risk_summary["risk_level"] == "insufficient_data":
            reasons.append("Client evidence is insufficient; do not interpret the risk score as a safety guarantee")
    rank = round(sum(components.values()), 1)
    if age is None:
        reasons.append("Publication/last-seen date unavailable; neutral freshness used")
    if feedback_samples < 3:
        reasons.append(f"Only {feedback_samples} similar historical outcomes; feedback influence is deliberately limited")
    return {
        "rank_score": rank,
        "components": components,
        "risk_assessment": risk_summary,
        "age_days": round(age, 1) if age is not None else None,
        "feedback_samples": feedback_samples,
        "reasons": reasons,
        "ranking_version": ranking_version,
    }

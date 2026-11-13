import re
from datetime import date, datetime

def tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-zA-Z0-9+#.]{2,}", (text or "").lower()))

def _list(value):
    return {str(x).strip().lower() for x in (value or []) if str(x).strip()}

def _deadline_days(value):
    if not value:
        return None
    try:
        return max(0, (date.fromisoformat(str(value)[:10]) - date.today()).days)
    except Exception:
        return None

def score_opportunity(profile, opportunity):
    """Return a deterministic 0-100 score and a transparent point breakdown.

    Client quality is neutral unless explicit client evidence is supplied.
    Competition and deadline scores are conservative when data is missing.
    """
    skills = _list(profile.get("skills"))
    required = _list(opportunity.get("required_skills"))
    if not required:
        required = tokens(opportunity.get("description", "")) & skills
    matched = skills & required
    skill_score = round(35 * len(matched) / len(required)) if required else 18

    minimum = float(profile.get("minimum_budget") or 0)
    budget_max = opportunity.get("budget_max")
    budget_min = opportunity.get("budget_min")
    budget = budget_max if budget_max is not None else budget_min
    if budget is None:
        budget_score = 10
    elif budget >= minimum:
        budget_score = 20
    elif minimum > 0:
        budget_score = max(0, round(20 * float(budget) / minimum))
    else:
        budget_score = 20

    # Only explicit platform/client data affects this component; unknown is neutral.
    rating = opportunity.get("client_rating")
    reviews = opportunity.get("client_reviews")
    payment_verified = opportunity.get("client_payment_verified")
    if rating is None and reviews is None and payment_verified is None:
        client_score = 8
        client_note = "Neutral: no client verification data supplied"
    else:
        client_score = 5
        if rating is not None:
            client_score += round(6 * max(0, min(5, float(rating))) / 5)
        if reviews is not None:
            client_score += 2 if int(reviews) >= 5 else 1 if int(reviews) > 0 else 0
        if payment_verified is True:
            client_score += 2
        client_score = min(15, client_score)
        client_note = "Based only on supplied client fields; verify source independently"

    days = _deadline_days(opportunity.get("deadline"))
    hours = opportunity.get("estimated_hours")
    weekly_hours = max(1, int(profile.get("weekly_hours") or 1))
    if days is None or hours is None:
        deadline_score = 5
    else:
        available_capacity = weekly_hours * max(0, days) / 7
        if hours <= available_capacity:
            deadline_score = 10
        elif available_capacity <= 0:
            deadline_score = 0
        else:
            deadline_score = max(0, round(10 * available_capacity / max(float(hours), 1)))

    competition = str(opportunity.get("competition_level") or "unknown").lower()
    competition_score = {"low": 10, "medium": 7, "high": 4, "unknown": 5}.get(competition, 5)

    description = (opportunity.get("description") or "").strip()
    words = len(description.split())
    has_deliverables = any(x in description.lower() for x in ("deliverable", "acceptance", "milestone", "provide", "build", "develop", "create"))
    scope_score = min(10, 3 + min(5, words // 35) + (2 if has_deliverables else 0))

    parts = {
        "skill_fit": skill_score,
        "budget_fit": budget_score,
        "client_quality": client_score,
        "deadline_feasibility": deadline_score,
        "competition_level": competition_score,
        "scope_clarity": scope_score,
    }
    dealbreakers = _list(profile.get("dealbreakers"))
    listing_text = ((opportunity.get("title") or "") + " " + (opportunity.get("description") or "")).lower()
    dealbreaker_matches = sorted(term for term in dealbreakers if term in listing_text)
    preferred_work_types = _list(profile.get("preferred_work_types"))
    preferred_industries = _list(profile.get("preferred_industries"))
    job_type = str(opportunity.get("job_type") or "unknown").lower()
    industry = str(opportunity.get("industry") or "").lower()
    preference_warnings = []
    if preferred_work_types and job_type not in {"unknown", ""} and job_type not in preferred_work_types:
        preference_warnings.append("Work type is outside your stated preferences")
    if preferred_industries and industry and industry not in preferred_industries:
        preference_warnings.append("Industry is outside your stated preferences")
    below_minimum = budget is not None and minimum > 0 and float(budget) < minimum
    notes = {
        "matched_skills": sorted(matched),
        "missing_skills": sorted(required - skills),
        "client_quality_note": client_note,
        "deadline_data_complete": days is not None and hours is not None,
        "competition_data_source": "provided opportunity metadata" if competition != "unknown" else "unknown; neutral score used",
        "budget_data_available": budget is not None,
        "dealbreaker_matches": dealbreaker_matches,
        "manual_review_required": bool(dealbreaker_matches or preference_warnings or below_minimum),
        "eligible_by_profile_rules": not bool(dealbreaker_matches or below_minimum),
        "eligibility_warnings": preference_warnings + (["Listed budget is below your minimum"] if below_minimum else []),
    }
    return min(100, sum(parts.values())), {"points": parts, "notes": notes}

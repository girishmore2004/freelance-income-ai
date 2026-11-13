from types import SimpleNamespace

from app.services.opportunity_intelligence import build_intelligence_record


def base_opportunity():
    return {
        "id": "opp-1", "source": "manual", "external_id": "job-1",
        "title": "Python FastAPI automation", "client_name": "Example",
        "description": "Build a Python FastAPI API integration and deliver documentation.",
        "source_url": "https://example.com/jobs/1", "budget_min": 500,
        "budget_max": 1000, "currency": "INR", "required_skills": ["python", "fastapi"],
        "deadline": "", "job_type": "fixed", "industry": "software",
        "estimated_hours": 20, "competition_level": "unknown",
        "client_rating": None, "client_reviews": None, "client_payment_verified": None,
        "published_at": None, "last_seen_at": None, "created_at": "2026-11-13T00:00:00+00:00",
        "source_origins": ["manual"], "duplicate_count": 0, "match_score": 0,
    }


def test_intelligence_recomputes_match_from_current_profile_and_explains_skills():
    profile = {"skills": ["python", "fastapi"], "minimum_budget": 300, "weekly_hours": 20}
    result = build_intelligence_record(base_opportunity(), profile, [])
    assert result["opportunity"]["match_score"] > 0
    assert result["opportunity"]["score_breakdown"]["notes"]["matched_skills"] == ["fastapi", "python"]
    assert result["profile_eligibility"]["eligible_by_profile_rules"] is True
    assert result["ranking"]["ranking_version"] == "v2-risk-aware"


def test_dealbreaker_is_visible_and_requires_manual_review():
    profile = {"skills": ["python"], "dealbreakers": ["unpaid test"], "minimum_budget": 0}
    item = base_opportunity()
    item["description"] += " Includes an unpaid test."
    result = build_intelligence_record(item, profile, [])
    assert result["profile_eligibility"]["manual_review_required"] is True
    assert result["profile_eligibility"]["dealbreaker_matches"] == ["unpaid test"]


def test_shortlist_state_and_notes_are_exposed_without_mutating_source_record():
    review = SimpleNamespace(decision="interested", notes="Ask about milestones", next_action_date="2026-11-20")
    result = build_intelligence_record(base_opportunity(), {"skills": ["python"]}, [], review)
    assert result["review"] == {
        "decision": "interested", "notes": "Ask about milestones", "next_action_date": "2026-11-20"
    }
    assert result["provenance"]["source_url"] == "https://example.com/jobs/1"


def test_missing_review_defaults_to_unreviewed():
    result = build_intelligence_record(base_opportunity(), {}, [], None)
    assert result["review"]["decision"] == "unreviewed"
    assert result["review"]["notes"] == ""

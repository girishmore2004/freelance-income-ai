from datetime import datetime, timezone

from app.services.opportunity_ranking import rank_opportunity
from app.services.opportunity_intelligence import build_intelligence_record


def test_risk_aware_rank_exposes_components_that_sum_to_total():
    now = datetime(2026, 11, 13, tzinfo=timezone.utc)
    opportunity = {"match_score": 80, "published_at": now.isoformat(), "industry": "software", "job_type": "fixed"}
    risk = {"risk_score": 70, "risk_level": "high", "evidence_coverage": 60}
    result = rank_opportunity(opportunity, [], now, risk_assessment=risk)
    assert result["ranking_version"] == "v2-risk-aware"
    assert result["components"]["risk_quality"] == 1.5
    assert sum(result["components"].values()) == result["rank_score"]
    assert result["risk_assessment"]["risk_level"] == "high"


def test_low_evidence_does_not_overstate_client_safety():
    now = datetime(2026, 11, 13, tzinfo=timezone.utc)
    opportunity = {"match_score": 50, "published_at": now.isoformat()}
    result = rank_opportunity(opportunity, [], now, risk_assessment={
        "risk_score": 0, "risk_level": "insufficient_data", "evidence_coverage": 0,
    })
    assert result["risk_assessment"]["confidence"] == 0
    assert result["components"]["risk_quality"] == 2.5


def test_opportunity_intelligence_flags_listing_risk_and_adds_questions():
    item = {
        "id": "opp-risk", "source": "manual", "external_id": "risk-1",
        "title": "Python automation", "client_name": "Unknown",
        "description": "Build an API and complete an unpaid test before payment.",
        "source_url": "https://example.test/job", "budget_min": 1000, "budget_max": 1000,
        "currency": "INR", "required_skills": ["python"], "deadline": "",
        "job_type": "fixed", "industry": "software", "estimated_hours": 8,
        "competition_level": "unknown", "client_rating": None, "client_reviews": None,
        "client_payment_verified": None, "published_at": None, "last_seen_at": None,
        "created_at": "2026-11-13T00:00:00+00:00", "source_origins": ["manual"],
        "duplicate_count": 0, "match_score": 0,
    }
    result = build_intelligence_record(item, {"skills": ["python"]}, [])
    ids = {signal["id"] for signal in result["client_risk"]["signals"]}
    assert "unpaid_test" in ids
    assert result["client_risk"]["risk_level"] in {"high", "elevated", "moderate"}
    assert result["ranking"]["ranking_version"] == "v2-risk-aware"
    assert any("flagged request" in question.lower() for question in result["client_risk"]["questions_to_ask"])

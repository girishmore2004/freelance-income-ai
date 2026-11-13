from app.scoring import score_opportunity

def test_score_uses_six_weighted_components_and_totals_100():
    profile = {
        "skills": ["python", "fastapi"],
        "minimum_budget": 10000,
        "weekly_hours": 20,
    }
    opportunity = {
        "required_skills": ["python", "fastapi"],
        "budget_max": 20000,
        "description": "Build and deliver a FastAPI service with clear acceptance criteria and milestones. " * 25,
        "estimated_hours": 10,
        "deadline": "2099-12-31",
        "competition_level": "low",
        "client_rating": 5,
        "client_reviews": 20,
        "client_payment_verified": True,
    }
    score, breakdown = score_opportunity(profile, opportunity)
    assert score == 100
    assert sum(breakdown["points"].values()) == 100
    assert set(breakdown["points"]) == {
        "skill_fit", "budget_fit", "client_quality",
        "deadline_feasibility", "competition_level", "scope_clarity",
    }

def test_unknown_client_data_is_neutral_not_fabricated():
    score, breakdown = score_opportunity(
        {"skills": ["python"], "minimum_budget": 5000, "weekly_hours": 10},
        {"required_skills": ["python"], "description": "Build a Python tool."},
    )
    assert breakdown["points"]["client_quality"] == 8
    assert "no client verification data" in breakdown["notes"]["client_quality_note"].lower()

def test_missing_skill_reduces_skill_fit():
    score, breakdown = score_opportunity(
        {"skills": ["python"], "minimum_budget": 5000, "weekly_hours": 10},
        {"required_skills": ["python", "react"], "description": "Build app."},
    )
    assert breakdown["points"]["skill_fit"] == 18
    assert breakdown["notes"]["missing_skills"] == ["react"]

from app.scoring import score_opportunity

def test_score_is_bounded_and_explainable():
    profile={"skills":["python","rag"],"minimum_budget":5000,"weekly_hours":20}
    job={"required_skills":["python","rag"],"budget_max":10000,
         "description":"Build a document assistant with retrieval and evaluation. "*10,
         "deadline":"2099-12-01","estimated_hours":8,"competition_level":"low"}
    score,breakdown=score_opportunity(profile,job)
    assert 0 <= score <= 100
    assert set(breakdown)=={"points","notes"}
    assert set(breakdown["points"])=={
        "skill_fit","budget_fit","client_quality","deadline_feasibility",
        "competition_level","scope_clarity"
    }
    assert score==sum(breakdown["points"].values())

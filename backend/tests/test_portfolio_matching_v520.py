from types import SimpleNamespace as NS
from app.services.portfolio_matching import match_opportunity_to_portfolio, build_opportunity_fit


def row(**kwargs):
    return NS(**kwargs)


def test_profile_skill_and_portfolio_evidence_are_explained():
    opportunity = row(id="o1", title="Build a React and Python RAG copilot", source="manual",
                      description="Create a knowledge base assistant with retrieval augmented generation. " * 8,
                      required_skills='["React.js", "Python", "RAG"]', budget_min=15000,
                      budget_max=30000, client_name="Acme", deadline="2026-12-01")
    profile = row(skills='["React", "Python"]', services='["AI RAG Copilot"]',
                  headline="Full-stack AI developer", bio="Builds production web applications")
    chunks = [row(id="c1", document_id="d1", chunk_index=0,
                  content="Portfolio project: React dashboard and Python backend for a retrieval augmented generation RAG knowledge assistant.")]
    docs = [row(id="d1", filename="RAG_Copilot_Case_Study.pdf")]
    result = match_opportunity_to_portfolio(opportunity, profile, chunks, docs)
    assert result["fit_score"] is not None
    assert result["matched_profile_skills"] == ["React.js", "Python"]
    assert set(result["portfolio_supported_skills"]) == {"React.js", "Python", "RAG"}
    assert result["potential_gaps"] == ["RAG"]
    assert result["portfolio_evidence"][0]["document"] == "RAG_Copilot_Case_Study.pdf"
    assert result["opportunity_quality_score"] is not None


def test_missing_profile_and_portfolio_data_withholds_fit_score():
    opportunity = row(id="o2", title="Unknown work", source="rss", description="Short description",
                      required_skills='["Rust", "Kubernetes"]', budget_min=None, budget_max=None,
                      client_name="Unknown", deadline="")
    result = match_opportunity_to_portfolio(opportunity, None, [], [])
    assert result["fit_score"] is None
    assert result["fit_components"] == {}
    assert result["opportunity_quality_score"] is not None
    assert result["quality_components"]["budget_transparency"] is None
    assert "No indexed portfolio chunks" in " ".join(result["reasons"])


def test_rank_is_deterministic_and_missing_required_skills_are_not_invented():
    opportunities = [
        row(id="b", title="Python data work", source="rss", description="Build data pipeline",
            required_skills='["Python"]', budget_min=10000, budget_max=None, client_name="Client", deadline=""),
        row(id="a", title="React website", source="manual", description="Build a website",
            required_skills='[]', budget_min=None, budget_max=None, client_name="Unknown", deadline=""),
    ]
    profile = row(skills='["Python"]', services='[]', headline="", bio="")
    first = build_opportunity_fit(opportunities, profile, [], [])
    second = build_opportunity_fit(opportunities, profile, [], [])
    assert [x["opportunity_id"] for x in first["opportunities"]] == [x["opportunity_id"] for x in second["opportunities"]]
    assert first["opportunities"][0]["opportunity_id"] == "b"
    assert first["opportunities"][1]["fit_score"] is None

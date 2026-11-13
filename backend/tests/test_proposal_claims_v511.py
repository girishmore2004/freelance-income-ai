from app.services.proposal_claims import validate_proposal_claims


def test_flags_experience_duration_and_quantified_outcomes():
    result = validate_proposal_claims(
        "I have 8 years of experience. I improved conversion by 45%.",
        {"evidence": []},
    )
    categories = {x["category"] for x in result["findings"]}
    assert "experience_duration" in categories
    assert "quantified_result" in categories
    assert result["status"] == "review_required"


def test_evidence_overlap_is_not_marked_as_proof():
    result = validate_proposal_claims(
        "I have 8 years of experience building Python APIs.",
        {"evidence": [{"content": "8 years of experience building Python APIs"}]},
    )
    finding = result["findings"][0]
    assert finding["status"] == "possible_support"
    assert "does not establish truth" in result["limitations"][1]


def test_ordinary_approach_proposal_has_no_high_risk_pattern():
    result = validate_proposal_claims(
        "I can review the requirements, agree milestones, implement the API and test acceptance criteria."
    )
    assert result["finding_count"] == 0
    assert result["status"] == "no_high_risk_pattern_detected"


def test_credentials_and_named_clients_are_flagged():
    result = validate_proposal_claims(
        "I am certified in AWS and worked with Acme Corporation on the platform."
    )
    categories = {x["category"] for x in result["findings"]}
    assert "credential" in categories
    assert "named_client_or_employer" in categories

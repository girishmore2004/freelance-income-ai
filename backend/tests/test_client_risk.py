from app.services.client_risk import assess_client_risk

def test_upfront_fee_is_critical_signal():
    report = assess_client_risk(
        {"title":"Remote assistant", "description":"Pay a registration fee before starting.", "source_url":"https://jobs.example"},
        [],
    )
    assert report["risk_level"] == "high"
    assert report["risk_score"] == 35
    assert report["signals"][0]["id"] == "upfront_payment"

def test_credential_request_scores_high():
    report = assess_client_risk(
        {"title":"Developer", "description":"Send your OTP and login credentials to begin."},
        [],
    )
    assert report["risk_level"] == "high"
    assert any(x["id"] == "credential_request" for x in report["signals"])

def test_no_evidence_is_not_called_low_risk():
    report = assess_client_risk({"title":"Developer", "description":"Build an app."}, [])
    assert report["risk_level"] == "insufficient_data"
    assert report["risk_score"] == 0

def test_linked_evidence_improves_coverage_but_does_not_verify_itself():
    report = assess_client_risk(
        {"title":"Developer", "description":"Build app.", "source_url":"https://market.example/job"},
        [{"claim":"Client profile exists", "evidence_type":"platform_profile",
          "evidence_url":"https://market.example/client", "confidence":"high"}],
    )
    assert report["evidence_coverage"] > 0
    assert any("not independently verified" in x for x in report["limitations"])

def test_evidence_signal_keeps_its_source_reference():
    report = assess_client_risk(
        {"title":"Developer", "description":"Build a dashboard."},
        [{"id":"e-1","claim":"Client asked for a registration fee.",
          "evidence_type":"client_history","evidence_url":"https://example.com/review",
          "confidence":"medium"}],
    )
    signal = next(x for x in report["signals"] if x["id"] == "upfront_payment")
    assert signal["sources"][0]["evidence_id"] == "e-1"
    assert signal["sources"][0]["source_url"] == "https://example.com/review"

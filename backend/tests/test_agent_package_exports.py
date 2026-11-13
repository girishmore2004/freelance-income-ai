def test_agent_package_exports_proposal_functions():
    from app.agents import proposal_agent, proposal_fingerprint, score_agent
    assert callable(proposal_agent)
    assert callable(proposal_fingerprint)
    assert callable(score_agent)

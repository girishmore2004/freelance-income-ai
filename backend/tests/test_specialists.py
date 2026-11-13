from app.agents.specialists import research_agent,outreach_agent,finance_agent,learning_agent
def test_research_requires_verified_source():
 assert research_agent([{"confidence":"verified","evidence_url":"https://example.com"},{"confidence":"verified","evidence_url":""}])["verified_count"]==1
def test_outreach_disabled(): assert outreach_agent(True)["allowed"] is False
def test_finance(): assert finance_agent([{"amount":90,"status":"paid"},{"amount":10,"status":"unpaid"}])["outstanding_total"]==10
def test_learning(): assert learning_agent([{"outcome":"won"},{"outcome":"lost"}])["feedback_count"]==2

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_risk_assessment_requires_auth():
    response = client.post("/api/v1/research/assess", json={"opportunity_id":"missing"})
    assert response.status_code in (401, 403)

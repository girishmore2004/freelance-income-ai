from fastapi.testclient import TestClient
from app.main import app
client=TestClient(app)
def test_health(): assert client.get('/health').json()['status']=='ok'
def test_registration_and_profile():
    import uuid
    email=f"test-{uuid.uuid4()}@example.com"
    r=client.post('/api/v1/auth/register',json={"email":email,"password":"StrongPassword123!"})
    assert r.status_code==200
    h={"Authorization":f"Bearer {r.json()['access_token']}"}
    p=client.put('/api/v1/profile',headers=h,json={"full_name":"Test User","skills":["Python"],"services":[],"portfolio_links":[],"minimum_budget":5000,"currency":"INR","weekly_hours":10})
    assert p.status_code==200 and p.json()['skills']==['Python']

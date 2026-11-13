from fastapi.testclient import TestClient
from app.main import app
import uuid
client = TestClient(app)

def auth():
    email=f"queue-{uuid.uuid4()}@example.com"
    response=client.post("/api/v1/auth/register",json={"email":email,"password":"StrongPassword123!"})
    return {"Authorization":f"Bearer {response.json()['access_token']}"}

def test_background_job_list_is_user_scoped():
    headers=auth()
    response=client.get("/api/v1/background-jobs",headers=headers)
    assert response.status_code == 200
    assert response.json() == []

import uuid
from types import SimpleNamespace
from fastapi.testclient import TestClient
import app.main as main

client = TestClient(main.app)

class FakeQueue:
    def enqueue(self, *args, **kwargs):
        return SimpleNamespace(id="test-rq-workflow-1")

def register_user():
    email = f"workflow-{uuid.uuid4()}@example.com"
    response = client.post("/api/v1/auth/register", json={
        "email": email,
        "password": "StrongPassword123!",
    })
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}

def test_workflow_is_created_and_user_scoped(monkeypatch):
    monkeypatch.setattr(main.settings, "public_registration", True)
    monkeypatch.setattr(main, "get_queue", lambda: FakeQueue())

    headers = register_user()

    opportunity = client.post(
        "/api/v1/opportunities",
        headers=headers,
        json={
            "title": "Build a Python reporting automation",
            "description": (
                "Create a Python workflow that imports monthly files "
                "and generates reports."
            ),
            "required_skills": ["Python", "Automation"],
            "currency": "INR",
        },
    )

    assert opportunity.status_code == 200, opportunity.text

    started = client.post(
        "/api/v1/workflows",
        headers=headers,
        json={
            "opportunity_id": opportunity.json()["id"],
            "proposed_price": 15000,
            "currency": "INR",
        },
    )

    assert started.status_code == 200, started.text
    workflow_id = started.json()["workflow_id"]

    assert started.json()["status"] == "queued"

    detail = client.get(
        f"/api/v1/workflows/{workflow_id}",
        headers=headers,
    )

    assert detail.status_code == 200
    assert detail.json()["status"] == "queued"

    other_user = register_user()

    hidden = client.get(
        f"/api/v1/workflows/{workflow_id}",
        headers=other_user,
    )

    assert hidden.status_code == 404

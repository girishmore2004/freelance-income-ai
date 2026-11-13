"""Cross-account isolation regression tests for core freelance records.

These tests intentionally use two separate authenticated users and exercise
both list visibility and mutation/read authorization. No external services
or marketplace actions are called.
"""
import uuid

from fastapi.testclient import TestClient
import app.main as main


client = TestClient(main.app)


def register_user():
    email = f"tenant-v32-{uuid.uuid4().hex}@example.test"
    response = client.post("/api/v1/auth/register", json={
        "email": email,
        "password": "StrongPassword123!",
    })
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_core_records_are_isolated_between_users():
    owner = register_user()
    other = register_user()

    opportunity_response = client.post("/api/v1/opportunities", headers=owner, json={
        "title": "Private Python automation opportunity",
        "description": "Build a private invoice automation and reporting workflow.",
        "required_skills": ["Python"],
        "external_id": f"tenant-{uuid.uuid4().hex}",
        "currency": "INR",
    })
    assert opportunity_response.status_code == 200, opportunity_response.text
    opportunity_id = opportunity_response.json()["id"]

    project_response = client.post("/api/v1/projects", headers=owner, json={
        "title": "Private client delivery project",
        "client_name": "Private Client",
        "description": "Confidential project owned by the first account.",
        "budget": 25000,
        "currency": "INR",
    })
    assert project_response.status_code == 200, project_response.text
    project_id = project_response.json()["id"]

    invoice_response = client.post("/api/v1/invoices", headers=owner, json={
        "project_id": project_id,
        "invoice_number": f"INV-{uuid.uuid4().hex[:10]}",
        "amount": 12000,
        "currency": "INR",
        "due_date": "2030-01-31",
    })
    assert invoice_response.status_code == 200, invoice_response.text
    invoice_id = invoice_response.json()["id"]

    task_response = client.post("/api/v1/tasks", headers=owner, json={
        "project_id": project_id,
        "title": "Private delivery task",
        "description": "Do not expose this task to another account.",
    })
    assert task_response.status_code == 200, task_response.text
    task_id = task_response.json()["id"]

    milestone_response = client.post("/api/v1/milestones", headers=owner, json={
        "project_id": project_id,
        "title": "Private project milestone",
        "amount": 5000,
        "currency": "INR",
        "due_date": "2030-02-01",
    })
    assert milestone_response.status_code == 200, milestone_response.text
    milestone_id = milestone_response.json()["id"]

    research_response = client.post("/api/v1/research", headers=owner, json={
        "opportunity_id": opportunity_id,
        "client_name": "Private Client",
        "evidence_type": "user_note",
        "claim": "Private research note owned by the first account.",
        "confidence": "unverified",
    })
    assert research_response.status_code == 200, research_response.text

    # A second account sees none of the first account's records.
    assert client.get("/api/v1/opportunities", headers=other).json() == []
    assert client.get("/api/v1/projects", headers=other).json() == []
    assert client.get("/api/v1/invoices", headers=other).json() == []
    assert client.get("/api/v1/tasks", headers=other).json() == []
    assert client.get("/api/v1/milestones", headers=other).json() == []
    assert client.get("/api/v1/research", headers=other).json() == []

    # Direct reads and mutations are denied across account boundaries.
    assert client.get(f"/api/v1/opportunities/{opportunity_id}", headers=other).status_code == 404
    assert client.patch(
        f"/api/v1/invoices/{invoice_id}/status",
        headers=other,
        json={"status": "paid"},
    ).status_code == 404
    assert client.patch(
        f"/api/v1/tasks/{task_id}",
        headers=other,
        json={"status": "done"},
    ).status_code == 404
    assert client.patch(
        f"/api/v1/milestones/{milestone_id}",
        headers=other,
        json={"title": "Unauthorized overwrite"},
    ).status_code == 404

    # Child records cannot be created against another user's parent project.
    assert client.post("/api/v1/tasks", headers=other, json={
        "project_id": project_id,
        "title": "Cross-account task injection",
    }).status_code == 404
    assert client.post("/api/v1/invoices", headers=other, json={
        "project_id": project_id,
        "invoice_number": "CROSS-ACCOUNT",
        "amount": 1,
    }).status_code == 404

    # The owner still sees the records after all rejected cross-account calls.
    assert len(client.get("/api/v1/projects", headers=owner).json()) == 1
    assert len(client.get("/api/v1/invoices", headers=owner).json()) == 1
    assert len(client.get("/api/v1/tasks", headers=owner).json()) == 1
    assert len(client.get("/api/v1/milestones", headers=owner).json()) == 1

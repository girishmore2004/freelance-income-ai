"""Route-level cross-account tests for email, portfolio, delivery and finance records."""
import uuid
from fastapi.testclient import TestClient
import app.main as main

client = TestClient(main.app)
import pytest


@pytest.fixture(autouse=True)
def enable_registration_for_test(monkeypatch):
    monkeypatch.setattr(main.settings, "public_registration", True)

def register_user():
    email = f"tenant-v38-{uuid.uuid4().hex}@example.com"
    response = client.post("/api/v1/auth/register", json={
        "email": email, "password": "StrongPassword123!"
    })
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def create_project(headers, title="Private project"):
    response = client.post("/api/v1/projects", headers=headers, json={
        "title": title, "client_name": "Private client",
        "description": "Account-owned project", "budget": 15000, "currency": "INR"
    })
    assert response.status_code == 200, response.text
    return response.json()["id"]


def test_delivery_finance_and_time_entry_cross_account_references_are_rejected():
    owner, other = register_user(), register_user()
    project_id = create_project(owner)

    assert client.post(f"/api/v1/projects/{project_id}/deliverables", headers=owner, json={
        "title": "Private deliverable", "description": "Owner-only content"
    }).status_code == 200

    assert client.post(f"/api/v1/projects/{project_id}/deliverables", headers=other, json={
        "title": "Cross-account deliverable"
    }).status_code == 404
    assert client.get(f"/api/v1/projects/{project_id}/deliverables", headers=other).status_code == 404

    time_entry = client.post("/api/v1/time-entries", headers=other, json={
        "project_id": project_id, "work_date": "2026-11-13",
        "duration_minutes": 60, "description": "Should not attach to another user's project"
    })
    assert time_entry.status_code == 404

    schedule = client.post(f"/api/v1/projects/{project_id}/invoice-schedules", headers=other, json={
        "title": "Unauthorized schedule", "amount": 5000, "currency": "INR",
        "due_date": "2026-12-01"
    })
    assert schedule.status_code == 404

    assert client.get("/api/v1/invoice-schedules", headers=other).json() == []
    assert client.get("/api/v1/time-entries", headers=other).json() == []


def test_email_and_follow_up_cross_account_references_are_rejected():
    owner, other = register_user(), register_user()
    project_id = create_project(owner, "Email-linked private project")
    email = client.post("/api/v1/emails/intake", headers=owner, json={
        "provider": "manual", "external_id": f"mail-{uuid.uuid4().hex}",
        "sender_name": "Private sender", "sender_email": "sender@example.test",
        "subject": "Private client request", "body_text": "Please review the private project requirements.",
        "project_id": project_id
    })
    assert email.status_code == 200, email.text
    email_id = email.json()["id"]

    cross_email = client.post("/api/v1/follow-ups", headers=other, json={
        "email_id": email_id, "title": "Unauthorized follow-up",
        "due_at": "2026-11-20T10:00:00Z"
    })
    assert cross_email.status_code == 404

    cross_project = client.post("/api/v1/follow-ups", headers=other, json={
        "project_id": project_id, "title": "Unauthorized project reminder",
        "due_at": "2026-11-20T10:00:00Z"
    })
    assert cross_project.status_code == 404

    cross_intake = client.post("/api/v1/emails/intake", headers=other, json={
        "provider": "manual", "subject": "Attempted cross-account link",
        "body_text": "Trying to attach an email to another user's project.",
        "project_id": project_id
    })
    assert cross_intake.status_code == 404
    assert client.get("/api/v1/emails", headers=other).json() == []


def test_portfolio_documents_and_chunks_are_account_scoped(monkeypatch):
    async def no_embedding(_text):
        return [], ""
    monkeypatch.setattr(main, "embed_text", no_embedding)

    owner, other = register_user(), register_user()
    upload = client.post(
        "/api/v1/portfolio/documents", headers=owner,
        files={"file": ("private-portfolio.txt", b"Confidential portfolio content for owner account.", "text/plain")}
    )
    assert upload.status_code == 200, upload.text
    assert len(client.get("/api/v1/portfolio/documents", headers=owner).json()) == 1
    assert client.get("/api/v1/portfolio/documents", headers=other).json() == []

    owner_search = client.post("/api/v1/portfolio/search", headers=owner, params={"query": "Confidential portfolio"})
    other_search = client.post("/api/v1/portfolio/search", headers=other, params={"query": "Confidential portfolio"})
    assert owner_search.status_code == 200
    assert other_search.status_code == 200
    assert other_search.json() == []

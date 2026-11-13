"""Authenticated opportunity-to-delivery regression.

All AI generation is stubbed and all records use the test database. No
marketplace submission, email, client handover or payment is performed.
"""
import uuid

import pytest
from fastapi.testclient import TestClient

import app.main as main


client = TestClient(main.app)


def _register():
    email = f"v41-{uuid.uuid4().hex}@example.com"
    response = client.post("/api/v1/auth/register", json={
        "email": email, "password": "StrongPassword123!"
    })
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_authenticated_opportunity_to_invoice_lifecycle(monkeypatch):
    # Avoid model providers and external network calls in a deterministic CI test.
    monkeypatch.setattr(
        main, "run_opportunity_graph",
        lambda profile, opportunity: {"score": 88, "breakdown": {"skills": 88}},
    )

    async def fake_proposal_agent(profile, opportunity, proposed_price):
        return (
            "Hello, I can deliver the requested API integration with tests, "
            "documentation, milestone updates and a final quality review.",
            "test_stub",
        )

    monkeypatch.setattr(main, "proposal_agent", fake_proposal_agent)
    headers = _register()

    opportunity = client.post("/api/v1/opportunities", headers=headers, json={
        "source": "manual",
        "external_id": "journey-" + uuid.uuid4().hex,
        "title": "Build a tested FastAPI integration",
        "client_name": "Example client",
        "description": "Implement a documented API integration with tests and delivery notes.",
        "required_skills": ["Python", "FastAPI"],
        "budget_min": 15000,
        "budget_max": 25000,
        "currency": "INR",
    })
    assert opportunity.status_code == 200, opportunity.text
    opportunity_id = opportunity.json()["id"]

    draft = client.post("/api/v1/proposals/generate", headers=headers, json={
        "opportunity_id": opportunity_id,
        "proposed_price": 18000,
        "currency": "INR",
    })
    assert draft.status_code == 200, draft.text
    proposal_id = draft.json()["id"]
    assert draft.json()["status"] == "draft"

    approval = client.post(
        f"/api/v1/proposals/{proposal_id}/request-approval", headers=headers
    )
    assert approval.status_code == 200, approval.text
    decision = client.post(
        f"/api/v1/approvals/{approval.json()['id']}/decision",
        headers=headers,
        json={"decision": "approved", "note": "Reviewed by account owner"},
    )
    assert decision.status_code == 200, decision.text

    ready = client.post(
        f"/api/v1/applications/{proposal_id}/mark-ready", headers=headers
    )
    assert ready.status_code == 200, ready.text
    assert ready.json()["external_submission"] == "not_performed"

    project = client.post("/api/v1/projects", headers=headers, json={
        "title": "FastAPI integration delivery",
        "client_name": "Example client",
        "description": "Project created from an approved opportunity proposal.",
        "budget": 18000,
        "currency": "INR",
        "due_date": "2030-06-30",
    })
    assert project.status_code == 200, project.text
    project_id = project.json()["id"]

    linked = client.put(
        f"/api/v1/projects/{project_id}/origin-opportunity",
        headers=headers,
        json={"opportunity_id": opportunity_id},
    )
    assert linked.status_code == 200, linked.text

    deliverable = client.post(
        f"/api/v1/projects/{project_id}/deliverables",
        headers=headers,
        json={
            "title": "Source code and test report",
            "description": "Reviewed integration source and automated test report.",
            "content_reference": "private://journey-v43/deliverable",
            "due_date": "2030-06-25",
        },
    )
    assert deliverable.status_code == 200, deliverable.text
    deliverable_id = deliverable.json()["id"]

    review = client.post(
        f"/api/v1/deliverables/{deliverable_id}/submit-for-review",
        headers=headers,
    )
    assert review.status_code == 200, review.text
    reviewed = client.post(
        f"/api/v1/deliverables/{deliverable_id}/review",
        headers=headers,
        json={
            "decision": "approve",
            "review_hash": review.json()["review_hash"],
            "note": "Internal QA complete",
        },
    )
    assert reviewed.status_code == 200, reviewed.text

    # The test records a handover reference only; it does not transmit files.
    handover = client.post(
        f"/api/v1/deliverables/{deliverable_id}/record-delivery",
        headers=headers,
        json={"delivery_reference": "Manual handover not performed in test"},
    )
    assert handover.status_code == 200, handover.text

    invoice = client.post("/api/v1/invoices", headers=headers, json={
        "project_id": project_id,
        "invoice_number": "V43-" + uuid.uuid4().hex[:12],
        "amount": 18000,
        "currency": "INR",
        "due_date": "2030-07-15",
    })
    assert invoice.status_code == 200, invoice.text
    assert invoice.json()["status"] == "unpaid"

    invoices = client.get("/api/v1/invoices", headers=headers)
    assert invoices.status_code == 200
    assert any(row["id"] == invoice.json()["id"] for row in invoices.json())

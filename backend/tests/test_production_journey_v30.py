
"""API-level regression tests for the human-approved proposal journey.

These tests use the application's configured test database and replace only the
proposal text generator. They never call an external marketplace or email provider.
"""
import uuid

import pytest
from fastapi.testclient import TestClient

import app.main as main


client = TestClient(main.app)


def register_user():
    email = f"v30-{uuid.uuid4().hex}@example.com"
    response = client.post("/api/v1/auth/register", json={
        "email": email,
        "password": "StrongPassword123!",
    })
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def deterministic_proposal(monkeypatch):
    async def fake_proposal_agent(profile, opportunity, proposed_price, evidence):
        return (
            "Hello, I can deliver the requested Python automation with clear "
            "milestones, testing, documentation and handover.",
            "test_stub",
        )

    monkeypatch.setattr(main, "proposal_agent", fake_proposal_agent)


def create_proposal(headers):
    opportunity = client.post("/api/v1/opportunities", headers=headers, json={
        "title": "Python invoice automation",
        "description": "Build a Python automation that extracts invoice fields and creates reports.",
        "required_skills": ["Python", "Automation"],
        "currency": "INR",
    })
    assert opportunity.status_code == 200, opportunity.text

    proposal = client.post("/api/v1/proposals/generate", headers=headers, json={
        "opportunity_id": opportunity.json()["id"],
        "proposed_price": 18000,
        "currency": "INR",
    })
    assert proposal.status_code == 200, proposal.text
    return proposal.json()


def test_editing_proposal_invalidates_old_pending_approval_and_requires_new_approval(
    deterministic_proposal,
):
    owner = register_user()
    proposal = create_proposal(owner)

    first_request = client.post(
        f"/api/v1/proposals/{proposal['id']}/request-approval", headers=owner
    )
    assert first_request.status_code == 200
    old_approval_id = first_request.json()["id"]

    edited = client.put(f"/api/v1/proposals/{proposal['id']}", headers=owner, json={
        "content": (
            "Hello, I can deliver the invoice automation with validation, "
            "error handling, milestones, tests and full documentation."
        ),
        "proposed_price": 22000,
    })
    assert edited.status_code == 200
    assert edited.json()["version"] == proposal["version"] + 1

    old_decision = client.post(
        f"/api/v1/approvals/{old_approval_id}/decision",
        headers=owner,
        json={"decision": "approved", "note": "This approval is stale."},
    )
    assert old_decision.status_code == 409

    not_ready = client.post(
        f"/api/v1/applications/{proposal['id']}/mark-ready", headers=owner
    )
    assert not_ready.status_code == 403

    second_request = client.post(
        f"/api/v1/proposals/{proposal['id']}/request-approval", headers=owner
    )
    assert second_request.status_code == 200

    approved = client.post(
        f"/api/v1/approvals/{second_request.json()['id']}/decision",
        headers=owner,
        json={"decision": "approved", "note": "Reviewed the updated price and scope."},
    )
    assert approved.status_code == 200

    ready = client.post(
        f"/api/v1/applications/{proposal['id']}/mark-ready", headers=owner
    )
    assert ready.status_code == 200
    assert ready.json()["external_submission"] == "not_performed"


def test_rejected_proposal_cannot_be_marked_ready(deterministic_proposal):
    owner = register_user()
    proposal = create_proposal(owner)

    request = client.post(
        f"/api/v1/proposals/{proposal['id']}/request-approval", headers=owner
    )
    assert request.status_code == 200

    rejected = client.post(
        f"/api/v1/approvals/{request.json()['id']}/decision",
        headers=owner,
        json={"decision": "rejected", "note": "Scope needs revision."},
    )
    assert rejected.status_code == 200
    assert rejected.json()["decision"] == "rejected"

    assert client.post(
        f"/api/v1/applications/{proposal['id']}/mark-ready", headers=owner
    ).status_code == 403


def test_proposal_and_approval_are_tenant_scoped(deterministic_proposal):
    owner = register_user()
    other = register_user()
    proposal = create_proposal(owner)

    approval = client.post(
        f"/api/v1/proposals/{proposal['id']}/request-approval", headers=owner
    )
    assert approval.status_code == 200

    assert client.put(f"/api/v1/proposals/{proposal['id']}", headers=other, json={
        "content": "An unauthorized user must never be able to change this proposal.",
        "proposed_price": 1,
    }).status_code == 404

    assert client.post(
        f"/api/v1/approvals/{approval.json()['id']}/decision",
        headers=other,
        json={"decision": "approved"},
    ).status_code == 404

    assert client.post(
        f"/api/v1/applications/{proposal['id']}/mark-ready", headers=other
    ).status_code == 404


def test_workflow_resume_requires_approval_for_exact_current_proposal(
    deterministic_proposal, monkeypatch
):
    from types import SimpleNamespace

    from app.database import SessionLocal
    from app.models import WorkflowRun

    class FakeQueue:
        def enqueue(self, *args, **kwargs):
            return SimpleNamespace(id="v30-test-queue-job")

    monkeypatch.setattr(main, "get_queue", lambda: FakeQueue())

    owner = register_user()
    proposal = create_proposal(owner)

    workflow = client.post("/api/v1/workflows", headers=owner, json={
        "opportunity_id": proposal["opportunity_id"],
        "proposed_price": 18000,
        "currency": "INR",
    })
    assert workflow.status_code == 200, workflow.text
    workflow_id = workflow.json()["workflow_id"]

    db = SessionLocal()
    try:
        row = db.get(WorkflowRun, workflow_id)
        assert row is not None
        row.proposal_id = proposal["id"]
        db.commit()
    finally:
        db.close()

    first_approval = client.post(
        f"/api/v1/proposals/{proposal['id']}/request-approval", headers=owner
    )
    assert first_approval.status_code == 200

    approved = client.post(
        f"/api/v1/approvals/{first_approval.json()['id']}/decision",
        headers=owner,
        json={"decision": "approved", "note": "Reviewed initial proposal."},
    )
    assert approved.status_code == 200

    edited = client.put(f"/api/v1/proposals/{proposal['id']}", headers=owner, json={
        "content": (
            "Updated scope includes invoice extraction, validation, error "
            "handling, automated reporting, testing and documentation."
        ),
        "proposed_price": 24000,
    })
    assert edited.status_code == 200

    stale_resume = client.post(
        f"/api/v1/workflows/{workflow_id}/resume", headers=owner
    )
    assert stale_resume.status_code == 409

    second_approval = client.post(
        f"/api/v1/proposals/{proposal['id']}/request-approval", headers=owner
    )
    assert second_approval.status_code == 200

    approved_again = client.post(
        f"/api/v1/approvals/{second_approval.json()['id']}/decision",
        headers=owner,
        json={"decision": "approved", "note": "Reviewed revised proposal."},
    )
    assert approved_again.status_code == 200

    resumed = client.post(
        f"/api/v1/workflows/{workflow_id}/resume", headers=owner
    )
    assert resumed.status_code == 200
    assert resumed.json()["status"] == "completed"
    assert resumed.json()["external_submission"] == "not_performed"

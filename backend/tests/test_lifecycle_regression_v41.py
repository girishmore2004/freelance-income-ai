"""End-to-end lifecycle and tenant-boundary regressions for v4.1.

These tests use local API/database fixtures and never contact a marketplace,
send an email, hand a deliverable to a client, or move money.
"""
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

import app.main as main
from app.database import SessionLocal
from app.models import (
    Approval, Invoice, MarketplaceAuditEvent, Proposal, User,
    WorkflowCheckpoint, WorkflowRun,
)

client = TestClient(main.app)


def register_user():
    email = f"v41-{uuid.uuid4().hex}@example.test"
    response = client.post("/api/v1/auth/register", json={
        "email": email, "password": "StrongPassword123!"
    })
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}, email


def make_project(headers):
    response = client.post("/api/v1/projects", headers=headers, json={
        "title": "Lifecycle regression project",
        "client_name": "Test client",
        "description": "Project created for release regression coverage",
        "budget": 25000,
        "currency": "INR",
    })
    assert response.status_code == 200, response.text
    return response.json()["id"]


def make_opportunity(headers):
    response = client.post("/api/v1/opportunities", headers=headers, json={
        "title": "Private API integration task",
        "description": "Build a documented API integration with tests.",
        "required_skills": ["Python", "FastAPI"],
        "external_id": f"v41-{uuid.uuid4().hex}",
        "currency": "INR",
    })
    assert response.status_code == 200, response.text
    return response.json()["id"]


def make_proposal(headers, email, opportunity_id):
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        proposal = Proposal(
            user_id=user.id,
            opportunity_id=opportunity_id,
            version=1,
            content="I will deliver the API integration with tests and documentation.",
            proposed_price=18000,
            currency="INR",
            status="draft",
        )
        db.add(proposal)
        db.commit()
        db.refresh(proposal)
        return proposal.id, main.hashlib.sha256(proposal.content.encode("utf-8")).hexdigest()


def test_marketplace_application_requires_proposal_hash_and_tracks_manual_submission():
    owner, email = register_user()
    other, _ = register_user()
    opportunity_id = make_opportunity(owner)
    proposal_id, proposal_hash = make_proposal(owner, email, opportunity_id)

    created = client.post("/api/v1/marketplace-applications", headers=owner, json={
        "provider": "upwork",
        "opportunity_id": opportunity_id,
        "proposal_id": proposal_id,
    })
    assert created.status_code == 200, created.text
    app_id = created.json()["id"]

    assert client.post(f"/api/v1/marketplace-applications/{app_id}/approve",
                       headers=owner, json={"proposal_hash": "wrong"}).status_code == 409
    assert client.post(f"/api/v1/marketplace-applications/{app_id}/approve",
                       headers=other, json={"proposal_hash": proposal_hash}).status_code == 404

    approved = client.post(f"/api/v1/marketplace-applications/{app_id}/approve",
                           headers=owner, json={"proposal_hash": proposal_hash})
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"

    assert client.post(f"/api/v1/marketplace-applications/{app_id}/record-submission",
                       headers=owner, json={"external_application_id": "manual-ref-123"}).status_code == 200
    tracked = client.patch(f"/api/v1/marketplace-applications/{app_id}/status",
                           headers=owner, json={"status": "interviewing", "note": "Manually updated"})
    assert tracked.status_code == 200, tracked.text
    assert tracked.json()["status"] == "interviewing"

    audit = client.get(f"/api/v1/marketplace-applications/{app_id}/audit", headers=owner)
    assert audit.status_code == 200
    event_types = {event["event_type"] for event in audit.json()}
    assert {"application_draft_created", "application_approved",
            "submission_recorded", "status_changed"}.issubset(event_types)
    assert client.get(f"/api/v1/marketplace-applications/{app_id}/audit",
                      headers=other).status_code == 404


def test_invoice_schedule_requires_hash_approval_before_single_invoice_creation():
    owner, _ = register_user()
    other, _ = register_user()
    project_id = make_project(owner)
    created = client.post(f"/api/v1/projects/{project_id}/invoice-schedules",
                          headers=owner, json={
        "title": "Milestone 1 completion",
        "amount": 8500,
        "currency": "INR",
        "due_date": "2030-02-15",
    })
    assert created.status_code == 200, created.text
    schedule_id = created.json()["id"]
    approval_hash = created.json()["approval_hash"]

    assert client.post(f"/api/v1/invoice-schedules/{schedule_id}/issue",
                       headers=owner, json={"invoice_number": "INV-V41-001"}).status_code == 409
    assert client.post(f"/api/v1/invoice-schedules/{schedule_id}/approve",
                       headers=owner, json={"approval_hash": "tampered"}).status_code == 409
    assert client.post(f"/api/v1/invoice-schedules/{schedule_id}/approve",
                       headers=other, json={"approval_hash": approval_hash}).status_code == 404

    # Simulate a concurrent/direct schedule edit after the approval hash was
    # issued; the stale hash must no longer authorize invoice creation.
    from app.models import InvoiceSchedule
    with SessionLocal() as db:
        schedule = db.get(InvoiceSchedule, schedule_id)
        schedule.amount = 9900
        db.commit()
    assert client.post(f"/api/v1/invoice-schedules/{schedule_id}/approve",
                       headers=owner, json={"approval_hash": approval_hash}).status_code == 409
    with SessionLocal() as db:
        schedule = db.get(InvoiceSchedule, schedule_id)
        approval_hash = main._schedule_hash(
            schedule.project_id, schedule.milestone_id, schedule.title,
            schedule.amount, schedule.currency, schedule.due_date,
        )

    approved = client.post(f"/api/v1/invoice-schedules/{schedule_id}/approve",
                           headers=owner, json={"approval_hash": approval_hash})
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"

    issued = client.post(f"/api/v1/invoice-schedules/{schedule_id}/issue",
                         headers=owner, json={"invoice_number": "INV-V41-001"})
    assert issued.status_code == 200, issued.text
    assert issued.json()["status"] == "unpaid"
    assert "no email or payment request was sent" in issued.json()["note"].lower()
    assert client.post(f"/api/v1/invoice-schedules/{schedule_id}/issue",
                       headers=owner, json={"invoice_number": "INV-V41-002"}).status_code == 409
    assert client.post(f"/api/v1/invoice-schedules/{schedule_id}/issue",
                       headers=other, json={"invoice_number": "INV-V41-003"}).status_code == 404

    with SessionLocal() as db:
        invoices = db.scalars(select(Invoice).where(
            Invoice.invoice_number == "INV-V41-001"
        )).all()
        assert len(invoices) == 1


def test_deliverable_review_hash_and_manual_handover_lifecycle():
    owner, _ = register_user()
    other, _ = register_user()
    project_id = make_project(owner)
    created = client.post(f"/api/v1/projects/{project_id}/deliverables",
                          headers=owner, json={
        "title": "Integration source and test report",
        "description": "Reviewed deliverable",
        "content_reference": "private://release/v41",
        "due_date": "2030-03-01",
    })
    assert created.status_code == 200, created.text
    deliverable_id = created.json()["id"]

    assert client.post(f"/api/v1/deliverables/{deliverable_id}/submit-for-review",
                       headers=other).status_code == 404
    submitted = client.post(f"/api/v1/deliverables/{deliverable_id}/submit-for-review",
                            headers=owner)
    assert submitted.status_code == 200, submitted.text
    review_hash = submitted.json()["review_hash"]

    assert client.post(f"/api/v1/deliverables/{deliverable_id}/review",
                       headers=owner, json={
        "decision": "approve", "review_hash": "wrong"
    }).status_code == 409
    approved = client.post(f"/api/v1/deliverables/{deliverable_id}/review",
                           headers=owner, json={
        "decision": "approve", "review_hash": review_hash,
        "note": "Internal QA passed",
    })
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"

    delivered = client.post(f"/api/v1/deliverables/{deliverable_id}/record-delivery",
                            headers=owner, json={
        "delivery_reference": "Manually handed over through agreed client channel"
    })
    assert delivered.status_code == 200, delivered.text
    assert delivered.json()["status"] == "delivered"

    accepted = client.patch(f"/api/v1/deliverables/{deliverable_id}/client-status",
                           headers=owner, json={
        "status": "accepted", "note": "Client acceptance recorded manually"
    })
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "accepted"

    assert client.patch(f"/api/v1/deliverables/{deliverable_id}",
                        headers=owner, json={"description": "Late edit"}).status_code == 409
    assert client.get(f"/api/v1/deliverables/{deliverable_id}/revisions",
                      headers=other).status_code == 404
    summary = client.get(f"/api/v1/projects/{project_id}/delivery-summary", headers=owner)
    assert summary.status_code == 200, summary.text
    assert summary.json()["deliverables_total"] == 1


def test_workflow_resume_requires_owner_and_current_approval_and_records_checkpoint():
    owner, email = register_user()
    other, _ = register_user()
    opportunity_id = make_opportunity(owner)
    proposal_id, _ = make_proposal(owner, email, opportunity_id)

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        proposal = db.get(Proposal, proposal_id)
        approval_hash = main.proposal_fingerprint(proposal)
        approval = Approval(
            user_id=user.id, proposal_id=proposal.id,
            decision="approved", proposal_hash=approval_hash,
            note="Human approval for automated regression test",
        )
        db.add(approval)
        db.flush()
        run = WorkflowRun(
            user_id=user.id, opportunity_id=opportunity_id,
            proposal_id=proposal.id, approval_id=approval.id,
            status="approved", current_step="awaiting_approval",
            state_json='{"test":"v41"}',
        )
        db.add(run)
        db.commit()
        workflow_id = run.id

    assert client.post(f"/api/v1/workflows/{workflow_id}/resume",
                       headers=other).status_code == 404
    resumed = client.post(f"/api/v1/workflows/{workflow_id}/resume", headers=owner)
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()["status"] == "completed"
    assert resumed.json()["external_submission"] == "not_performed"

    with SessionLocal() as db:
        run = db.get(WorkflowRun, workflow_id)
        checkpoints = db.scalars(select(WorkflowCheckpoint).where(
            WorkflowCheckpoint.workflow_id == workflow_id
        )).all()
        assert run.status == "completed"
        assert run.current_step == "human_approval_confirmed"
        assert any(item.node_name == "human_approval_confirmed" for item in checkpoints)


def test_workflow_resume_rejects_stale_proposal_approval():
    owner, email = register_user()
    opportunity_id = make_opportunity(owner)
    proposal_id, _ = make_proposal(owner, email, opportunity_id)
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        proposal = db.get(Proposal, proposal_id)
        old_fingerprint = main.proposal_fingerprint(proposal)
        approval = Approval(
            user_id=user.id, proposal_id=proposal.id,
            decision="approved", proposal_hash=old_fingerprint,
        )
        db.add(approval)
        db.flush()
        run = WorkflowRun(
            user_id=user.id, opportunity_id=opportunity_id,
            proposal_id=proposal.id, approval_id=approval.id,
            status="approved", current_step="awaiting_approval", state_json="{}",
        )
        db.add(run)
        db.commit()
        workflow_id = run.id
        proposal.content = "Changed after approval; a new human approval is required."
        db.commit()

    response = client.post(f"/api/v1/workflows/{workflow_id}/resume", headers=owner)
    assert response.status_code == 409

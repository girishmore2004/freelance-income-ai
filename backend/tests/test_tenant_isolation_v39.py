
"""Additional tenant-boundary API regressions for OAuth metadata, marketplace,
deliverable revisions, invoice schedules and durable workflow checkpoints.

No provider calls, email sends, marketplace submissions or payments occur.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

import app.main as main
from app.models import (
    User,
    EmailProviderAccount,
    WorkflowRun,
    WorkflowCheckpoint,
)
from app.database import SessionLocal


client = TestClient(main.app)


@pytest.fixture(autouse=True)
def enable_registration_for_test(monkeypatch):
    monkeypatch.setattr(
        main.settings,
        "public_registration",
        True,
    )


def register_user():
    email = f"tenant-v39-{uuid.uuid4().hex}@example.com"

    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPassword123!",
        },
    )

    assert response.status_code == 200, response.text

    return {
        "Authorization": f"Bearer {response.json()['access_token']}"
    }, email


def make_project(headers):
    response = client.post(
        "/api/v1/projects",
        headers=headers,
        json={
            "title": "v39 tenant project",
            "client_name": "Private client",
            "description": "Private project for tenant regression tests.",
            "budget": 20000,
            "currency": "INR",
        },
    )

    assert response.status_code == 200, response.text

    return response.json()["id"]


def test_marketplace_settings_and_applications_are_account_scoped():
    owner, _ = register_user()
    other, _ = register_user()

    project = make_project(owner)

    opportunity = client.post(
        "/api/v1/opportunities",
        headers=owner,
        json={
            "title": "Private marketplace opportunity",
            "description": "A private opportunity used for tenant regression.",
            "required_skills": ["Python"],
            "external_id": f"v39-{uuid.uuid4().hex}",
            "currency": "INR",
        },
    )

    assert opportunity.status_code == 200, opportunity.text

    opportunity_id = opportunity.json()["id"]

    setting = client.put(
        "/api/v1/marketplaces/upwork/settings",
        headers=owner,
        json={"access_mode": "manual"},
    )

    assert setting.status_code == 200, setting.text

    fiverr_setting = client.put(
        "/api/v1/marketplaces/fiverr/settings",
        headers=owner,
        json={"access_mode": "manual"},
    )

    assert fiverr_setting.status_code == 200, fiverr_setting.text

    app_response = client.post(
        "/api/v1/marketplace-applications",
        headers=owner,
        json={
            "provider": "upwork",
            "opportunity_id": opportunity_id,
        },
    )

    assert app_response.status_code == 200, app_response.text

    app_id = app_response.json()["id"]

    assert client.get(
        "/api/v1/marketplace-applications",
        headers=other,
    ).json() == []

    assert client.get(
        f"/api/v1/marketplace-applications/{app_id}/audit",
        headers=other,
    ).status_code == 404

    own_applications = client.get(
        "/api/v1/marketplace-applications",
        headers=owner,
    )

    assert own_applications.status_code == 200
    assert own_applications.json()[0]["id"] == app_id

    assert client.get(
        "/api/v1/marketplaces",
        headers=other,
    ).status_code == 200


def test_deliverable_revisions_and_invoice_schedule_are_owner_scoped():
    owner, _ = register_user()
    other, _ = register_user()

    project = make_project(owner)

    deliverable = client.post(
        f"/api/v1/projects/{project}/deliverables",
        headers=owner,
        json={
            "title": "Versioned private deliverable",
            "description": "Initial version",
        },
    )

    assert deliverable.status_code == 200, deliverable.text

    deliverable_id = deliverable.json()["id"]

    # A content change must carry an explicit revision origin.
    # "other" is valid when no client-feedback or scope-change evidence
    # is being claimed.
    revision = client.patch(
        f"/api/v1/deliverables/{deliverable_id}",
        headers=owner,
        json={
            "description": "Second version",
            "change_note": "Owner update",
            "revision_origin": "other",
            "origin_note": "Owner-initiated content update",
        },
    )

    assert revision.status_code == 200, revision.text

    own_revisions = client.get(
        f"/api/v1/deliverables/{deliverable_id}/revisions",
        headers=owner,
    )

    assert own_revisions.status_code == 200
    assert len(own_revisions.json()) == 2

    assert client.get(
        f"/api/v1/deliverables/{deliverable_id}/revisions",
        headers=other,
    ).status_code == 404

    schedule = client.post(
        f"/api/v1/projects/{project}/invoice-schedules",
        headers=owner,
        json={
            "title": "Private milestone invoice",
            "amount": 7500,
            "currency": "INR",
            "due_date": "2030-01-15",
        },
    )

    assert schedule.status_code == 200, schedule.text

    assert client.get(
        "/api/v1/invoice-schedules",
        headers=other,
    ).json() == []

    own_schedules = client.get(
        "/api/v1/invoice-schedules",
        headers=owner,
    )

    assert own_schedules.status_code == 200
    assert len(own_schedules.json()) == 1

    assert client.post(
        f"/api/v1/invoice-schedules/{schedule.json()['id']}/approve",
        headers=other,
        json={"approval_hash": schedule.json()["approval_hash"]},
    ).status_code == 404


def test_email_provider_account_listing_is_scoped_and_never_returns_tokens():
    owner_headers, owner_email = register_user()
    other_headers, _ = register_user()

    with SessionLocal() as db:
        owner = db.query(User).filter(
            User.email == owner_email
        ).one()

        db.add(
            EmailProviderAccount(
                user_id=owner.id,
                provider="google",
                provider_email="private@example.test",
                access_token_encrypted="encrypted-access-placeholder",
                refresh_token_encrypted="encrypted-refresh-placeholder",
                scopes="gmail.readonly",
                status="connected",
            )
        )

        db.commit()

    own = client.get(
        "/api/v1/email-integrations",
        headers=owner_headers,
    )

    other = client.get(
        "/api/v1/email-integrations",
        headers=other_headers,
    )

    assert own.status_code == 200
    assert len(own.json()) == 1

    assert other.status_code == 200
    assert other.json() == []

    assert "access_token" not in own.text
    assert "refresh_token" not in own.text


def test_workflow_checkpoint_detail_is_hidden_from_other_account():
    owner_headers, owner_email = register_user()
    other_headers, _ = register_user()

    with SessionLocal() as db:
        owner = db.query(User).filter(
            User.email == owner_email
        ).one()

        opportunity = main.Opportunity(
            user_id=owner.id,
            source="manual",
            external_id=f"workflow-{uuid.uuid4().hex}",
            title="Private workflow opportunity",
            description="Workflow tenant test",
        )

        db.add(opportunity)
        db.flush()

        run = WorkflowRun(
            user_id=owner.id,
            opportunity_id=opportunity.id,
            status="completed",
            current_step="done",
            state_json="{}",
        )

        db.add(run)
        db.flush()

        db.add(
            WorkflowCheckpoint(
                workflow_id=run.id,
                sequence=1,
                node_name="private_checkpoint",
                state_json='{"secret":"owner-only"}',
            )
        )

        db.commit()

        workflow_id = run.id

    own = client.get(
        f"/api/v1/workflows/{workflow_id}",
        headers=owner_headers,
    )

    hidden = client.get(
        f"/api/v1/workflows/{workflow_id}",
        headers=other_headers,
    )

    assert own.status_code == 200
    assert len(own.json()["checkpoints"]) == 1
    assert hidden.status_code == 404

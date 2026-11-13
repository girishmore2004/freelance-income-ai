from app.services.client_communication_planner import build_communication_plan


def test_communication_plan_uses_saved_email_and_portfolio_evidence():
    emails = [{
        "id": "email-1", "sender_name": "Client", "sender_email": "client@example.com",
        "subject": "Python automation proposal", "body_text": "Please share your Python automation approach.",
        "category": "proposal", "status": "new", "project_id": None,
    }]
    profile = {
        "full_name": "Freelancer", "headline": "Python developer",
        "bio": "", "skills": ["Python"], "services": ["Automation"],
        "hourly_rate": 0, "currency": "INR", "timezone": "Asia/Kolkata",
    }
    chunks = [{
        "id": "chunk-1", "document_id": "doc-1", "chunk_index": 0,
        "content": "Built Python automation scripts for spreadsheet processing.",
        "embedding": [], "filename": "Portfolio.pdf",
    }]
    result = build_communication_plan(emails, profile, [], chunks)
    assert len(result) == 1
    assert result[0]["email_id"] == "email-1"
    assert result[0]["requires_human_review"] is True
    assert result[0]["send_action"] == "not_available_in_workflow"
    assert any(source.get("chunk_id") == "chunk-1" for source in result[0]["portfolio_sources"])


def test_communication_plan_excludes_closed_and_sent_messages():
    emails = [
        {"id": "sent", "subject": "Please confirm", "body_text": "Please confirm", "status": "sent"},
        {"id": "closed", "subject": "Urgent", "body_text": "Urgent issue", "status": "closed"},
    ]
    result = build_communication_plan(emails, {"timezone": "UTC"}, [], [])
    assert result == []


def test_communication_plan_caps_and_sorts_by_urgency():
    emails = [
        {"id": "normal", "subject": "Question", "body_text": "Please review", "status": "new"},
        {"id": "urgent", "subject": "Urgent blocker", "body_text": "Urgent, production down, blocked", "status": "new"},
    ]
    result = build_communication_plan(emails, {"timezone": "UTC"}, [], [], limit=1)
    assert len(result) == 1
    assert result[0]["email_id"] == "urgent"

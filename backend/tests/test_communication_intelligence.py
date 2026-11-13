from datetime import datetime, timezone
from app.services.communication_intelligence import (
    analyze_message, suggest_projects, follow_up_recommendation, build_context,
)


def test_urgent_blocked_message_gets_high_score_and_reasons():
    result = analyze_message("URGENT: deployment blocked", "Production is blocked. Need help immediately today.")
    assert result["urgency"] == "high"
    assert result["urgency_score"] >= 60
    assert result["urgency_reasons"]
    assert result["sentiment"] == "neutral"


def test_sentiment_uses_visible_lexicon_evidence():
    positive = analyze_message("Great work", "Thanks, excellent and perfect.")
    negative = analyze_message("Issue with delivery", "I am disappointed; the update failed.")
    assert positive["sentiment"] == "positive"
    assert "excellent" in positive["sentiment_evidence"]
    assert negative["sentiment"] == "negative"
    assert "failed" not in negative["sentiment_evidence"] or "issue" in negative["sentiment_evidence"]


def test_project_suggestions_rank_title_and_client_overlap():
    projects = [
        {"id": "p1", "title": "Shopify storefront redesign", "client_name": "Acme Retail", "description": "React commerce UI"},
        {"id": "p2", "title": "Data dashboard", "client_name": "Other Co", "description": "Power BI analytics"},
    ]
    matches = suggest_projects("Acme Retail Shopify redesign", "Need a small update to our storefront", projects)
    assert matches
    assert matches[0]["project_id"] == "p1"
    assert matches[0]["reasons"]


def test_project_suggestion_does_not_return_empty_match():
    assert suggest_projects("hello there", "thanks for the note", [
        {"id": "p1", "title": "Unrelated ERP migration", "client_name": "Contoso", "description": "SAP implementation"}
    ]) == []


def test_high_urgency_follow_up_is_next_day_and_timezone_aware():
    now = datetime(2026, 11, 12, 10, 0, tzinfo=timezone.utc)
    plan = follow_up_recommendation(
        {"subject": "Urgent quote", "body_text": "Please send the proposal today", "category": "project_enquiry"},
        {"urgency": "high", "urgency_score": 80}, now,
    )
    assert plan["days"] == 1
    assert datetime.fromisoformat(plan["due_at"]).tzinfo is not None


def test_thanks_only_message_has_no_follow_up():
    plan = follow_up_recommendation(
        {"subject": "Thanks", "body_text": "Just saying thanks, no further action needed", "category": "general"},
        {"urgency": "low", "urgency_score": 0},
    )
    assert plan is None


def test_context_contains_only_selected_portfolio_chunks_and_sources():
    context = build_context(
        {"subject": "React dashboard", "body_text": "Need React dashboard help", "project_id": "p1"},
        {"full_name": "Freelancer", "skills": ["React"], "services": ["Web apps"]},
        [{"id": "p1", "title": "Client dashboard", "client_name": "Acme", "description": "React app"}],
        [{"subject": "Previous dashboard", "body_text": "We discussed chart filters", "received_at": "2026-11-01"}],
        [
            {"id": "c1", "document_id": "d1", "chunk_index": 0, "content": "Built React dashboards with chart filters", "embedding": [], "filename": "portfolio.txt"},
            {"id": "c2", "document_id": "d2", "chunk_index": 0, "content": "Organic gardening and soil", "embedding": [], "filename": "other.txt"},
        ],
    )
    assert context["retrieval_count"] == 1
    assert context["project"]["id"] == "p1"
    assert context["recent_email_history"][0]["subject"] == "Previous dashboard"
    assert any(source["type"] == "portfolio" for source in context["sources"])


def test_context_falls_back_to_lexical_when_embedding_dimensions_differ():
    context = build_context(
        {"subject": "React dashboard", "body_text": "React dashboard charts", "project_id": None},
        {"skills": ["React"]}, [], [],
        [{"id": "c1", "document_id": "d1", "chunk_index": 0,
          "content": "React dashboard charts and filters", "embedding": [0.1, 0.2, 0.3]}],
        query_embedding=[0.1, 0.2],
    )
    assert context["retrieval_count"] == 1
    assert context["retrieval_mode"] == ["lexical_cosine"]


def test_project_match_ignores_generic_words():
    projects = [{"id": "p1", "title": "ERP migration", "client_name": "Contoso", "description": "SAP rollout"}]
    assert suggest_projects("Please send update", "Need a small update from you", projects) == []


def test_high_urgency_follow_up_skips_weekend():
    now = datetime(2026, 11, 13, 10, 0, tzinfo=timezone.utc)  # Friday
    plan = follow_up_recommendation(
        {"subject": "Urgent blocked", "body_text": "Please fix this immediately", "category": "project_update"},
        {"urgency": "high", "urgency_score": 90}, now,
    )
    assert datetime.fromisoformat(plan["due_at"]).weekday() == 0  # Monday


def test_follow_up_uses_profile_timezone():
    now = datetime(2026, 11, 12, 10, 0, tzinfo=timezone.utc)
    plan = follow_up_recommendation(
        {"subject": "Proposal request", "body_text": "Please send a quote", "category": "project_enquiry"},
        {"urgency": "low", "urgency_score": 0}, now, "Asia/Kolkata",
    )
    due = datetime.fromisoformat(plan["due_at"])
    assert due.utcoffset().total_seconds() == 19800

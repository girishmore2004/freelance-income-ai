"""Read-only communication planning over saved email and portfolio records."""
from .communication_intelligence import (
    analyze_message, follow_up_recommendation, build_context,
)


def build_communication_plan(emails, profile, projects, chunks, limit=30):
    recommendations = []
    for email in emails[:max(0, limit * 2)]:
        intelligence = analyze_message(email.get("subject", ""), email.get("body_text", ""))
        follow_up = follow_up_recommendation(
            email, intelligence, timezone_name=profile.get("timezone", "UTC")
        )
        project = next((x for x in projects if x["id"] == email.get("project_id")), None)
        context = build_context(
            email=email, profile=profile, projects=projects, recent_emails=[],
            chunks=chunks, query_embedding=None, top_k=3,
        )
        if email.get("status") in {"sent", "archived", "closed"}:
            continue
        if not (follow_up or intelligence.get("urgency_score", 0) >= 25
                or email.get("status") in {"new", "unread"}):
            continue
        recommendations.append({
            "email_id": email["id"], "subject": email.get("subject", ""),
            "sender": email.get("sender_name") or email.get("sender_email") or "Unknown sender",
            "category": email.get("category", "general"),
            "urgency": intelligence["urgency"], "urgency_score": intelligence["urgency_score"],
            "urgency_reasons": intelligence["urgency_reasons"],
            "sentiment_indicator": intelligence["sentiment"],
            "follow_up": follow_up,
            "linked_project": {"id": project["id"], "title": project["title"]} if project else None,
            "project_matches": context.get("project_matches", [])[:2],
            "portfolio_sources": context.get("sources", [])[:3],
            "reply_guidance": "Acknowledge the specific request, use only verified profile/project/portfolio facts, and ask focused questions where details are missing.",
            "requires_human_review": True,
            "send_action": "not_available_in_workflow",
        })
    recommendations.sort(key=lambda x: (-x["urgency_score"], x["subject"]))
    return recommendations[:max(0, limit)]

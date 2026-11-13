"""Explainable client-message intelligence and grounded reply context assembly."""
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .retrieval import rank_chunks, tokenize

POSITIVE = {
    "thanks", "thank", "great", "excellent", "appreciate", "pleased",
    "happy", "perfect", "approved", "wonderful", "good",
}
NEGATIVE = {
    "issue", "problem", "disappointed", "unhappy", "wrong", "broken",
    "delay", "late", "complaint", "refund", "poor", "failed",
}
URGENT = {
    "urgent", "asap", "immediately", "today", "tonight", "deadline",
    "blocked", "blocking", "critical", "emergency", "overdue",
}
ACTION = {
    "please", "confirm", "send", "share", "review", "approve", "schedule",
    "meeting", "call", "quote", "proposal", "estimate", "deliver", "fix",
    "update", "payment", "invoice", "question", "help", "need", "request",
}
MATCH_STOPWORDS = {
    "please", "thanks", "thank", "hello", "there", "need", "small", "update",
    "our", "your", "about", "with", "this", "that", "from", "have", "for",
    "the", "and", "you", "are", "can", "could", "would", "hi", "regards",
    "re", "fw", "following", "message", "client", "project", "work",
}


def analyze_message(subject: str, body: str) -> dict:
    """Rule-based indicators, not a model's claim about the sender's feelings."""
    text = f"{subject or ''} {body or ''}".lower()
    words = set(tokenize(text))
    positive_hits = sorted(words & POSITIVE)
    negative_hits = sorted(words & NEGATIVE)
    urgent_hits = sorted(words & URGENT)
    score = min(100, len(urgent_hits) * 24)
    reasons = [f"Urgency wording: {', '.join(urgent_hits)}"] if urgent_hits else []
    if re.search(r"\b(within|by|before)\s+(the\s+)?(next\s+)?\d{1,2}\s*(hour|hours|hr|hrs)\b", text):
        score = min(100, score + 25)
        reasons.append("A short hour-based deadline is mentioned")
    if any(x in text for x in ("cannot proceed", "can't proceed", "work is blocked", "blocked on", "production down")):
        score = min(100, score + 30)
        reasons.append("A blocker or service-impact phrase is present")
    if any(x in text for x in ("payment overdue", "payment is overdue", "invoice overdue", "past due")):
        score = min(100, score + 20)
        reasons.append("Overdue payment wording is present")
    if score >= 60:
        urgency = "high"
    elif score >= 25:
        urgency = "medium"
    else:
        urgency = "low"
    if len(negative_hits) > len(positive_hits):
        sentiment = "negative"
    elif len(positive_hits) > len(negative_hits):
        sentiment = "positive"
    else:
        sentiment = "neutral"
    sentiment_evidence = sorted(set(positive_hits + negative_hits))
    return {
        "sentiment": sentiment,
        "sentiment_evidence": sentiment_evidence,
        "urgency": urgency,
        "urgency_score": score,
        "urgency_reasons": reasons or ["No explicit urgency indicators found"],
        "analysis_version": "rules-v1",
        "disclaimer": "Heuristic text indicators only; not a reliable assessment of a person's actual emotional state.",
    }


def suggest_projects(subject: str, body: str, projects: list[dict], limit: int = 3) -> list[dict]:
    query = set(tokenize(f"{subject} {body}")) - MATCH_STOPWORDS
    if not query:
        return []
    ranked = []
    for project in projects:
        title_tokens = set(tokenize(project.get("title", ""))) - MATCH_STOPWORDS
        client_tokens = set(tokenize(project.get("client_name", ""))) - MATCH_STOPWORDS
        description_tokens = set(tokenize(project.get("description", ""))) - MATCH_STOPWORDS
        overlap = query & (title_tokens | client_tokens | description_tokens)
        if not overlap:
            continue
        denominator = max(1, len(query))
        score = min(1.0, sum(3 if x in title_tokens else 2 if x in client_tokens else 1 for x in overlap) / (3 * denominator))
        if score <= 0:
            continue
        reasons = []
        if query & title_tokens:
            reasons.append("message mentions project-title terms")
        if query & client_tokens:
            reasons.append("message mentions client-name terms")
        if query & description_tokens:
            reasons.append("message overlaps project-description terms")
        ranked.append({
            "project_id": project["id"],
            "title": project.get("title", ""),
            "client_name": project.get("client_name", ""),
            "score": round(score, 4),
            "confidence": "medium" if score >= 0.35 else "low",
            "reasons": reasons,
        })
    return sorted(ranked, key=lambda x: (x["score"], x["title"]), reverse=True)[:limit]


def follow_up_recommendation(
    email: dict, intelligence: dict, now: datetime | None = None, timezone_name: str = "UTC"
) -> dict | None:
    text = f"{email.get('subject', '')} {email.get('body_text', '')}".lower()
    if any(x in text for x in ("no further action", "nothing else needed", "just saying thanks", "thank you only")):
        return None
    if not (set(tokenize(text)) & ACTION) and intelligence.get("urgency_score", 0) < 25:
        return None
    if intelligence.get("urgency") == "high":
        days, cadence = 1, "next business day"
    elif email.get("category") == "payment":
        days, cadence = 3, "3 days"
    else:
        days, cadence = 4, "4 days"
    try:
        local_tz = ZoneInfo(timezone_name or "UTC")
    except ZoneInfoNotFoundError:
        local_tz = timezone.utc
    base = now or datetime.now(local_tz)
    if base.tzinfo is None:
        base = base.replace(tzinfo=local_tz)
    else:
        base = base.astimezone(local_tz)
    due = base + timedelta(days=days)
    if cadence == "next business day":
        while due.weekday() >= 5:
            due += timedelta(days=1)
    return {
        "title": f"Follow up: {email.get('subject') or 'client email'}",
        "due_at": due.isoformat(),
        "days": days,
        "cadence": cadence,
        "reason": "Suggested from the message's request/action indicators and urgency rules. Review before creating a reminder.",
    }


def build_context(
    email: dict,
    profile: dict,
    projects: list[dict],
    recent_emails: list[dict],
    chunks: list[dict],
    query_embedding: list[float] | None = None,
    top_k: int = 4,
) -> dict:
    query = f"{email.get('subject', '')}\n{email.get('body_text', '')}"[:4000]
    ranked = rank_chunks(query, query_embedding, chunks, limit=top_k)
    if not ranked and query_embedding:
        # If stored/query vector dimensions or providers differ, retain lexical recall.
        ranked = rank_chunks(query, None, chunks, limit=top_k)
    selected_project = next((p for p in projects if p.get("id") == email.get("project_id")), None)
    project_matches = suggest_projects(email.get("subject", ""), email.get("body_text", ""), projects)
    history = [
        {
            "subject": item.get("subject", ""),
            "body_text": (item.get("body_text", "") or "")[:1200],
            "received_at": item.get("received_at", ""),
            "category": item.get("category", ""),
        }
        for item in recent_emails[:5]
    ]
    sources = [
        {
            "type": "portfolio",
            "document_id": item.get("document_id"),
            "chunk_id": item.get("id"),
            "chunk_index": item.get("chunk_index"),
            "similarity": item.get("similarity"),
            "retrieval_method": item.get("retrieval_method"),
            "label": item.get("filename") or f"Portfolio document chunk {item.get('chunk_index', 0) + 1}",
        }
        for item in ranked
    ]
    if selected_project:
        sources.insert(0, {"type": "project", "project_id": selected_project["id"], "label": selected_project["title"]})
    if history:
        sources.append({"type": "email_history", "label": f"{len(history)} recent messages from this sender"})
    return {
        "profile": {
            "name": profile.get("full_name", ""),
            "headline": profile.get("headline", ""),
            "bio": (profile.get("bio", "") or "")[:1800],
            "skills": profile.get("skills", [])[:40],
            "services": profile.get("services", [])[:30],
            "hourly_rate": profile.get("hourly_rate", 0),
            "currency": profile.get("currency", "INR"),
        },
        "project": selected_project,
        "project_matches": project_matches,
        "recent_email_history": history,
        "portfolio_evidence": [
            {
                "label": item.get("filename") or f"Portfolio chunk {item.get('chunk_index', 0) + 1}",
                "similarity": item.get("similarity"),
                "content": item.get("content", "")[:1800],
            }
            for item in ranked
        ],
        "sources": sources,
        "retrieval_count": len(ranked),
        "retrieval_mode": sorted({x.get("retrieval_method", "") for x in ranked}),
    }

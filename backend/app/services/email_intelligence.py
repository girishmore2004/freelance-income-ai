def classify_client_email(subject: str, body: str) -> tuple[str, str]:
    text = f"{subject} {body}".lower()
    if any(k in text for k in ("invoice", "payment", "paid", "overdue", "bill")):
        category = "payment"
    elif any(k in text for k in ("proposal", "quote", "estimate", "budget", "scope")):
        category = "project_enquiry"
    elif any(k in text for k in ("deadline", "delivery", "bug", "revision", "milestone")):
        category = "project_update"
    elif any(k in text for k in ("meeting", "call", "schedule", "availability")):
        category = "meeting"
    else:
        category = "general"
    priority = "high" if any(k in text for k in ("urgent", "asap", "immediately", "today", "blocked")) else "normal"
    return category, priority

"""Evidence-linked next-action planning for the freelance business workspace.

This module is deterministic and recommendation-only. It never sends messages,
submits proposals, issues invoices, hands over deliverables, or moves money.
"""
from datetime import date, datetime, timezone


def _date(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def build_action_plan(
    *, invoices=(), tasks=(), reminders=(), opportunities=(), projects=(),
    milestones=(), deliverables=(), invoice_schedules=(), approvals=(),
    email_drafts=(), marketplace_applications=(), scope_changes=(), today=None, limit=12,
):
    """Build a bounded action queue from account-scoped records."""
    today = today or date.today()
    actions = []

    def add(priority, category, title, reason, entity_type, entity_id, action, due_date=None):
        actions.append({
            "priority": int(priority), "category": category, "title": title,
            "reason": reason, "evidence": {"type": entity_type, "id": entity_id},
            "suggested_action": action,
            "due_date": due_date.isoformat() if due_date else None,
            "requires_human_approval": True,
        })

    def due_priority(due, *, overdue=1, today_priority=2, upcoming=3):
        if due < today:
            return overdue
        if due == today:
            return today_priority
        return upcoming

    for row in invoices:
        status = str(getattr(row, "status", "")).lower()
        if status in {"paid", "void", "cancelled"}:
            continue
        due = _date(getattr(row, "due_date", None))
        if due and due <= today:
            label = "overdue" if due < today else "due today"
            add(1 if due < today else 2, "finance", f"Review {label} invoice {row.invoice_number}",
                f"Invoice due date is {due.isoformat()} and status is {row.status}.",
                "invoice", row.id, "Verify payment status, then decide whether to send a reminder.", due)

    for row in tasks:
        if str(getattr(row, "status", "")).lower() in {"done", "completed", "cancelled"}:
            continue
        due = _date(getattr(row, "due_date", None))
        if due and due <= today:
            label = "overdue" if due < today else "due today"
            add(due_priority(due), "delivery", f"Handle {label} task: {row.title}",
                f"Task status is {row.status}; recorded due date is {due.isoformat()}.",
                "task", row.id, "Review progress and update the task or delivery plan.", due)

    for row in reminders:
        if str(getattr(row, "status", "")).lower() not in {"open", "pending"}:
            continue
        due = _date(getattr(row, "due_at", None))
        if due and due <= today:
            add(due_priority(due, overdue=2, today_priority=2), "communication",
                f"Review follow-up: {row.title}",
                f"Follow-up reminder is still {row.status} and due {due.isoformat()}.",
                "follow_up_reminder", row.id,
                "Review the conversation and approve or edit a reply.", due)

    for row in opportunities:
        status = str(getattr(row, "status", "")).lower()
        if status in {"submitted", "applied", "won", "lost", "closed", "archived"}:
            continue
        created_date = _date(getattr(row, "created_at", None))
        age = (today - created_date).days if created_date else None
        if age is not None and age >= 14:
            add(4, "pipeline", f"Reassess stale opportunity: {row.title}",
                f"Opportunity is {age} days old and recorded status is {row.status}.",
                "opportunity", row.id,
                "Check whether it is still open; refresh research or archive it.")

    for row in projects:
        if str(getattr(row, "status", "")).lower() not in {"active", "in_progress", "in progress"}:
            continue
        due = _date(getattr(row, "due_date", None))
        if due and due <= today:
            label = "deadline passed" if due < today else "deadline is today"
            add(due_priority(due), "delivery", f"Review project {label}: {row.title}",
                f"Project is marked {row.status} with due date {due.isoformat()}.",
                "project", row.id,
                "Confirm delivery status and agree a revised plan with the client.", due)

    for row in milestones:
        if str(getattr(row, "status", "")).lower() in {"completed", "done", "cancelled", "paid"}:
            continue
        due = _date(getattr(row, "due_date", None))
        if due and due <= today:
            label = "overdue" if due < today else "due today"
            add(due_priority(due), "delivery", f"Review {label} milestone: {row.title}",
                f"Milestone status is {row.status}; due date is {due.isoformat()}.",
                "milestone", row.id,
                "Check acceptance criteria and update milestone progress with the client.", due)

    for row in deliverables:
        status = str(getattr(row, "status", "")).lower()
        if status in {"accepted", "delivered", "cancelled", "rejected"}:
            continue
        due = _date(getattr(row, "due_date", None))
        if status in {"submitted_for_review", "in_review", "pending_review"}:
            add(2, "delivery", f"Check deliverable review: {row.title}",
                f"Deliverable is awaiting review (status: {status}).",
                "deliverable", row.id,
                "Review the submitted version and record an explicit review decision.", due)
        elif due and due <= today:
            label = "overdue" if due < today else "due today"
            add(due_priority(due), "delivery", f"Prepare {label} deliverable: {row.title}",
                f"Deliverable status is {status}; due date is {due.isoformat()}.",
                "deliverable", row.id,
                "Check scope, quality and required evidence before submitting for review.", due)

    for row in invoice_schedules:
        status = str(getattr(row, "status", "")).lower()
        if status in {"issued", "invoiced", "cancelled", "void", "paid"} or getattr(row, "invoice_id", None):
            continue
        due = _date(getattr(row, "due_date", None))
        if status == "approved":
            add(due_priority(due, overdue=1, today_priority=2, upcoming=3) if due else 3,
                "finance", f"Review approved invoice schedule: {row.title}",
                f"Schedule is approved and has not yet produced an invoice (status: {status}).",
                "invoice_schedule", row.id,
                "Review the schedule and explicitly approve invoice issuance when appropriate.", due)
        elif due and due <= today:
            add(due_priority(due), "finance", f"Review invoice schedule: {row.title}",
                f"Invoice schedule is {status} and due {due.isoformat()}.",
                "invoice_schedule", row.id,
                "Review milestone completion and decide whether to approve the schedule.", due)

    for row in approvals:
        if str(getattr(row, "decision", "")).lower() == "pending":
            add(2, "approval", "Review pending proposal approval",
                "A proposal approval request is waiting for your decision.",
                "approval", row.id,
                "Inspect the exact proposal content, then approve or reject it.")

    for row in email_drafts:
        if str(getattr(row, "status", "")).lower() in {"pending_approval", "awaiting_approval"}:
            add(2, "communication", "Review client email draft",
                "A client reply draft is awaiting explicit approval.",
                "email_draft", row.id,
                "Verify recipient, context and message content before deciding whether to send.")

    for row in marketplace_applications:
        if str(getattr(row, "status", "")).lower() in {"approved", "ready"} and not getattr(row, "submitted_at", None):
            add(3, "pipeline", "Review approved marketplace application",
                f"Application for {getattr(row, 'provider', 'marketplace')} is approved but no submission is recorded.",
                "marketplace_application", row.id,
                "Open the marketplace directly, submit manually if still appropriate, then record the outcome.")

    for row in scope_changes:
        if str(getattr(row, "status", "")).lower() == "pending_approval":
            add(2, "approval", f"Review scope change: {row.title}",
                "A project scope change is awaiting a decision and explicit confirmation of client acceptance.",
                "scope_change", row.id,
                "Review the exact change and supporting client agreement before approving or rejecting it.")

    category_order = {
        "finance": 0, "approval": 1, "delivery": 2,
        "communication": 3, "pipeline": 4,
    }
    actions.sort(key=lambda x: (
        x["priority"], x["due_date"] or "9999-12-31",
        category_order.get(x["category"], 9), x["title"],
    ))
    selected = actions[:max(1, min(int(limit), 50))]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "as_of_date": today.isoformat(),
        "actions": selected,
        "total_actionable_records": len(actions),
        "returned_actions": len(selected),
        "policy": "Recommendations only. No external or irreversible action is executed. Each action requires a separate human decision.",
    }

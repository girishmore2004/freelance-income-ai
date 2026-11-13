"""Pure recommendation assembly for multi-agent workflow results.

This module has no database or model-provider dependency, making policy logic
straightforward to unit test.
"""


def build_action_plan(state):
    actions = []
    for item in state.get("matching_result", {}).get("ranked_opportunities", [])[:5]:
        if item["score"] >= 60:
            actions.append({
                "priority": 2, "category": "opportunity",
                "title": f"Review opportunity: {item['title']}",
                "reason": f"Profile match score is {item['score']}/100.",
                "evidence": {"type": "opportunity", "id": item["opportunity_id"]},
                "suggested_action": "Review client evidence, scope and pricing before deciding whether to draft a proposal.",
                "requires_human_approval": True,
            })
    for item in state.get("delivery_result", {}).get("overdue_tasks", []):
        actions.append({
            "priority": 1, "category": "delivery", "title": f"Review overdue task: {item['title']}",
            "reason": f"Task due date is {item['due_date']}.",
            "evidence": {"type": "project_task", "id": item["id"]},
            "suggested_action": "Review the task status and update the delivery plan manually.",
            "requires_human_approval": True,
        })
    for item in state.get("delivery_result", {}).get("overdue_deliverables", []):
        actions.append({
            "priority": 1, "category": "delivery", "title": f"Review overdue deliverable: {item['title']}",
            "reason": f"Deliverable due date is {item['due_date']}; current status is {item['status']}.",
            "evidence": {"type": "project_deliverable", "id": item["id"]},
            "suggested_action": "Inspect the latest revision and decide whether it is ready for client review.",
            "requires_human_approval": True,
        })
    for item in state.get("delivery_result", {}).get("overdue_projects", []):
        actions.append({
            "priority": 1, "category": "delivery", "title": f"Review project deadline: {item['title']}",
            "reason": f"Project due date is {item['due_date']}.",
            "evidence": {"type": "project", "id": item["id"]},
            "suggested_action": "Review remaining scope, milestones and client expectations.",
            "requires_human_approval": True,
        })
    for item in state.get("finance_result", {}).get("overdue_invoices", []):
        actions.append({
            "priority": 1, "category": "finance", "title": f"Review overdue invoice: {item['invoice_number']}",
            "reason": f"Invoice due date is {item['due_date']}; recorded amount is {item['amount']} {item['currency']}.",
            "evidence": {"type": "invoice", "id": item["id"]},
            "suggested_action": "Verify payment status and decide whether a client follow-up is appropriate.",
            "requires_human_approval": True,
        })
    actions.sort(key=lambda x: (x["priority"], x["category"], x["title"]))
    return actions[:20]

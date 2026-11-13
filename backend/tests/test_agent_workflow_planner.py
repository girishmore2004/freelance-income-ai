from app.services.agent_workflow_planner import build_action_plan


def test_planner_combines_specialist_recommendations_with_source_ids():
    state = {
        "matching_result": {"ranked_opportunities": [
            {"opportunity_id": "opp-1", "title": "Python automation", "score": 82},
            {"opportunity_id": "opp-2", "title": "Low fit", "score": 30},
        ]},
        "delivery_result": {
            "overdue_tasks": [{"id": "task-1", "title": "Finish API", "due_date": "2026-11-01"}],
            "overdue_deliverables": [{"id": "del-1", "title": "Final report", "due_date": "2026-11-02", "status": "draft"}],
            "overdue_projects": [{"id": "proj-1", "title": "Client portal", "due_date": "2026-11-03"}],
        },
        "finance_result": {"overdue_invoices": [
            {"id": "inv-1", "invoice_number": "INV-001", "amount": 5000, "currency": "INR", "due_date": "2026-11-04"},
        ]},
    }
    actions = build_action_plan(state)
    assert {x["evidence"]["id"] for x in actions} == {"opp-1", "task-1", "del-1", "proj-1", "inv-1"}
    assert all(x["requires_human_approval"] for x in actions)
    assert all(x["suggested_action"] for x in actions)


def test_planner_ignores_low_match_scores_and_empty_specialist_results():
    assert build_action_plan({
        "matching_result": {"ranked_opportunities": [{"opportunity_id": "x", "title": "Low fit", "score": 20}]},
        "delivery_result": {"overdue_tasks": [], "overdue_deliverables": [], "overdue_projects": []},
        "finance_result": {"overdue_invoices": []},
    }) == []


def test_planner_caps_recommendations_at_twenty():
    state = {
        "matching_result": {"ranked_opportunities": [
            {"opportunity_id": str(i), "title": f"Opportunity {i}", "score": 90}
            for i in range(30)
        ]},
        "delivery_result": {"overdue_tasks": [], "overdue_deliverables": [], "overdue_projects": []},
        "finance_result": {"overdue_invoices": []},
    }
    assert len(build_action_plan(state)) == 5

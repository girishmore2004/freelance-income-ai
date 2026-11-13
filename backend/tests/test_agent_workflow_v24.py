from app.agent_workflow_engine import (
    build_agent_workflow,
    _planner_node,
    _matching_node,
    _research_node,
    _delivery_node,
    _finance_node,
)
from app.services.agent_workflow_planner import build_action_plan


def test_graph_contains_all_specialist_stages():
    nodes = set(build_agent_workflow().get_graph().nodes)

    expected_nodes = {
        "context_loader",
        "matching",
        "client_research",
        "delivery",
        "finance",
        "proposal_strategy",
        "communication",
        "planner",
    }

    assert expected_nodes.issubset(nodes)


def test_planner_creates_evidence_linked_recommendations_only():
    state = {
        "matching_result": {
            "ranked_opportunities": [
                {
                    "opportunity_id": "opp-1",
                    "title": "Python automation",
                    "score": 82,
                },
                {
                    "opportunity_id": "opp-2",
                    "title": "Low fit",
                    "score": 30,
                },
            ]
        },
        "delivery_result": {
            "overdue_tasks": [
                {
                    "id": "task-1",
                    "title": "Finish API",
                    "due_date": "2026-11-01",
                },
            ]
        },
        "finance_result": {
            "overdue_invoices": [
                {
                    "id": "inv-1",
                    "invoice_number": "INV-001",
                    "amount": 5000,
                    "currency": "INR",
                    "due_date": "2026-11-02",
                },
            ]
        },
    }

    actions = build_action_plan(state)

    assert {x["evidence"]["id"] for x in actions} == {
        "opp-1",
        "task-1",
        "inv-1",
    }

    assert all(x["requires_human_approval"] for x in actions)
    assert all("suggested_action" in x for x in actions)


def test_completed_nodes_are_not_recomputed_on_resume():
    assert _matching_node({
        "matching_result": {"ranked_opportunities": []}
    }) == {}

    assert _research_node({
        "research_result": {"verified_count": 0}
    }) == {}

    assert _delivery_node({
        "delivery_result": {"open_task_count": 0}
    }) == {}

    assert _finance_node({
        "finance_result": {"paid_total": 0}
    }) == {}

    assert _planner_node({
        "action_plan": []
    }) == {}


def test_planner_is_empty_when_no_actionable_evidence():
    result = build_action_plan({
        "matching_result": {
            "ranked_opportunities": []
        },
        "delivery_result": {
            "overdue_tasks": []
        },
        "finance_result": {
            "overdue_invoices": []
        },
    })

    assert result == []

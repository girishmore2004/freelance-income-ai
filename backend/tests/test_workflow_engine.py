from app.workflow_engine import (
    build_freelance_workflow,
    _matching_node,
    _research_node,
    _pricing_node,
    _json_safe,
)

def test_graph_contains_all_durable_workflow_stages():
    graph = build_freelance_workflow()
    node_names = set(graph.get_graph().nodes)
    assert {"matching", "research", "pricing", "proposal"}.issubset(node_names)

def test_completed_matching_stage_is_not_recomputed_on_retry():
    state = {"match_score": 82, "score_breakdown": {"points": {"skills": 20}}}
    assert _matching_node(state) == {}

def test_completed_research_stage_is_not_recomputed_on_retry():
    state = {"research_summary": {"verified_count": 1}}
    assert _research_node(state) == {}

def test_completed_pricing_stage_is_not_recomputed_on_retry():
    state = {"pricing_advice": {"profile_floor_estimate": 10000}}
    assert _pricing_node(state) == {}

def test_checkpoint_state_is_json_serializable():
    value = _json_safe({"date_like": "2026-11-12", "score": 75, "skills": ["Python"]})
    assert value["score"] == 75
    assert value["skills"] == ["Python"]

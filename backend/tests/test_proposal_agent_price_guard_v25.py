import asyncio
from app import agents


def test_proposal_agent_does_not_invent_price_when_none_supplied(monkeypatch):
    captured = {}

    async def fake_generate(system, prompt):
        captured["system"] = system
        captured["prompt"] = prompt
        return "Draft proposal content"

    monkeypatch.setattr(agents, "generate_text", fake_generate)
    content, mode = asyncio.run(agents.proposal_agent(
        {"full_name": "Test User", "skills": ["Python"]},
        {"title": "Automation", "description": "Build an automation tool", "currency": "INR"},
        None,
    ))
    assert content == "Draft proposal content"
    assert mode == "model"
    assert "Do not invent, estimate, or state a price" in captured["prompt"]


def test_proposal_agent_preserves_explicit_user_price(monkeypatch):
    captured = {}

    async def fake_generate(system, prompt):
        captured["prompt"] = prompt
        return "Draft proposal content"

    monkeypatch.setattr(agents, "generate_text", fake_generate)
    asyncio.run(agents.proposal_agent(
        {"full_name": "Test User", "skills": ["Python"]},
        {"title": "Automation", "description": "Build an automation tool", "currency": "INR"},
        12000,
    ))
    assert "User-provided proposed price: 12000 INR" in captured["prompt"]

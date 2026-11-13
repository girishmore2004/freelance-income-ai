from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import pytest
from app.services.proposal_outcome_intelligence import build_proposal_outcome_intelligence


def record(**kwargs):
    defaults = {"id": "x", "opportunity_id": "opp", "created_at": datetime.now(timezone.utc)}
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def test_source_win_rate_is_withheld_below_minimum_sample_and_unknown_excluded():
    opps = [record(id=f"o{i}", source="upwork", description="Build a website", budget_max=1000)
            for i in range(4)]
    proposals = [record(id=f"p{i}", opportunity_id=f"o{i}", content="Hello, I understand the scope. Happy to discuss next steps.")
                 for i in range(4)]
    feedback = [record(id="f1", opportunity_id="o0", outcome="won"),
                record(id="f2", opportunity_id="o1", outcome="lost"),
                record(id="f3", opportunity_id="o2", outcome="no_response")]
    result = build_proposal_outcome_intelligence(opps, proposals, feedback, minimum_sample=2)
    row = result["sources"][0]
    assert row["wins"] == 1 and row["losses"] == 1
    assert row["unknown_or_undecided"] == 2
    assert row["decided_sample_size"] == 2
    assert row["win_rate_percent"] == 50.0
    assert row["minimum_sample_met"] is True


def test_win_rate_hidden_when_decided_sample_is_too_small():
    opp = record(id="o1", source="manual", description="Task")
    proposal = record(id="p1", opportunity_id="o1", content="Hello")
    feedback = record(id="f1", opportunity_id="o1", outcome="won")
    result = build_proposal_outcome_intelligence([opp], [proposal], [feedback], minimum_sample=5)
    assert result["sources"][0]["win_rate_percent"] is None
    assert result["sources"][0]["descriptive_win_rate_percent"] == 100.0


def test_latest_feedback_and_latest_proposal_are_used_once_per_opportunity():
    now = datetime.now(timezone.utc)
    opp = record(id="o1", source="contra", description="Build dashboard")
    old = record(id="p-old", opportunity_id="o1", content="Hello", created_at=now-timedelta(days=2))
    new = record(id="p-new", opportunity_id="o1", content="Hello, I understand the scope and happy to discuss next steps.", created_at=now)
    fb_old = record(id="f-old", opportunity_id="o1", outcome="lost", created_at=now-timedelta(days=1))
    fb_new = record(id="f-new", opportunity_id="o1", outcome="won", created_at=now)
    result = build_proposal_outcome_intelligence([opp], [old,new], [fb_old,fb_new], minimum_sample=2)
    row = result["sources"][0]
    assert row["proposals"] == 1
    assert row["wins"] == 1 and row["losses"] == 0


def test_rejects_unreasonably_low_minimum_sample():
    with pytest.raises(ValueError):
        build_proposal_outcome_intelligence([], [], [], minimum_sample=1)

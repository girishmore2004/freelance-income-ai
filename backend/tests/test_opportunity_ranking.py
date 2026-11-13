from datetime import datetime, timezone, timedelta
from app.services.opportunity_ranking import rank_opportunity

def test_rank_uses_freshness_and_explains_components():
    now=datetime(2026, 11, 12, tzinfo=timezone.utc)
    fresh={"match_score":80,"published_at":now.isoformat(),"industry":"software","job_type":"fixed"}
    old={**fresh,"published_at":(now-timedelta(days=90)).isoformat()}
    a=rank_opportunity(fresh,[],now)
    b=rank_opportunity(old,[],now)
    assert a["rank_score"] > b["rank_score"]
    assert sum(a["components"].values()) == a["rank_score"]
    assert a["ranking_version"] == "v1"

def test_feedback_is_smoothed_and_only_similar_categories_count():
    now=datetime(2026, 11, 12, tzinfo=timezone.utc)
    opp={"match_score":70,"industry":"software","job_type":"fixed","published_at":now.isoformat()}
    feedback=[{"outcome":"won","industry":"software","job_type":"fixed"}]
    result=rank_opportunity(opp,feedback,now)
    assert result["feedback_samples"] == 1
    assert 0 < result["components"]["historical_feedback"] < 10
    unrelated=rank_opportunity(opp,[{"outcome":"won","industry":"construction","job_type":"hourly"}],now)
    assert unrelated["feedback_samples"] == 0

def test_unknown_freshness_uses_neutral_score():
    result=rank_opportunity({"match_score":50},[],datetime(2026,11,12,tzinfo=timezone.utc))
    assert result["components"]["freshness"] == 10
    assert result["age_days"] is None

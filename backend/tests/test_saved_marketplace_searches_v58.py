import pytest
from pydantic import ValidationError
from app.schemas import SavedMarketplaceSearchIn, SavedMarketplaceSearchUpdate
from app.models import SavedMarketplaceSearch


def test_saved_search_accepts_supported_intervals_and_limits():
    payload = SavedMarketplaceSearchIn(search_term="  python automation  ", interval_hours=12, result_limit=50)
    assert payload.search_term.strip() == "python automation"
    assert payload.interval_hours == 12
    assert payload.result_limit == 50


@pytest.mark.parametrize("interval", [1, 5, 7, 23, 25, 48])
def test_saved_search_rejects_unsupported_intervals(interval):
    with pytest.raises(ValidationError):
        SavedMarketplaceSearchIn(search_term="python", interval_hours=interval)


def test_saved_search_update_rejects_unsupported_interval():
    with pytest.raises(ValidationError):
        SavedMarketplaceSearchUpdate(interval_hours=8)


def test_saved_search_is_tenant_owned_and_unique_per_user_provider_keyword():
    assert SavedMarketplaceSearch.__tablename__ == "saved_marketplace_searches"
    constraints = [c for c in SavedMarketplaceSearch.__table__.constraints if c.__class__.__name__ == "UniqueConstraint"]
    assert any(tuple(col.name for col in c.columns) == ("user_id", "provider", "search_term") for c in constraints)
    assert "user_id" in SavedMarketplaceSearch.__table__.c
    assert "next_run_at" in SavedMarketplaceSearch.__table__.c


def test_saved_search_rejects_whitespace_only_keyword():
    with pytest.raises(ValidationError):
        SavedMarketplaceSearchIn(search_term="   ")


def test_saved_search_update_rejects_whitespace_only_keyword():
    with pytest.raises(ValidationError):
        SavedMarketplaceSearchUpdate(search_term="   ")

import pytest
from app.services.marketplace_adapters import ADAPTERS, adapter_status


def test_upwork_adapter_exposes_only_read_only_capability():
    status = adapter_status("upwork")
    assert status["enabled"] is True
    assert status["capabilities"] == ["read_only_opportunity_search"]
    assert status["reason"]


def test_freelancer_adapter_remains_fail_closed():
    status = adapter_status("freelancer")
    assert status["enabled"] is False
    assert status["capabilities"] == []
    assert status["reason"]


@pytest.mark.asyncio
async def test_marketplace_submission_is_disabled_even_for_known_provider():
    with pytest.raises(RuntimeError, match="submission is disabled"):
        await ADAPTERS["upwork"].submit_application(opportunity_id="x")


@pytest.mark.asyncio
async def test_marketplace_discovery_does_not_claim_freelancer_api_support():
    with pytest.raises(RuntimeError, match="integration is not enabled"):
        await ADAPTERS["freelancer"].fetch_opportunities()


def test_unknown_provider_has_no_capabilities():
    result = adapter_status("unknown")
    assert result["enabled"] is False
    assert result["capabilities"] == []

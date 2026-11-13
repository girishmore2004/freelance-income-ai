"""Fail-closed marketplace adapter contracts with verified capability metadata."""
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class AdapterStatus:
    provider: str
    enabled: bool
    capabilities: tuple[str, ...]
    reason: str


class MarketplaceAdapter:
    provider = "base"

    def status(self) -> AdapterStatus:
        return AdapterStatus(self.provider, False, (), "Provider adapter is not configured")

    async def fetch_opportunities(self, **kwargs: Any) -> list[dict[str, Any]]:
        raise RuntimeError(f"{self.provider} API integration is not enabled; use a permitted feed or manual import")

    async def submit_application(self, **kwargs: Any) -> dict[str, Any]:
        raise RuntimeError("Marketplace submission is disabled; submit manually on the provider website")


class UpworkAdapter(MarketplaceAdapter):
    provider = "upwork"

    def status(self) -> AdapterStatus:
        return AdapterStatus(
            self.provider, True, ("read_only_opportunity_search",),
            "Official GraphQL read-only search is implemented. Each user needs approved Upwork API access, OAuth consent and the marketplace-read scope. Proposal submission is disabled.",
        )

    async def fetch_opportunities(self, **kwargs: Any) -> list[dict[str, Any]]:
        db = kwargs.get("db")
        user_id = kwargs.get("user_id")
        search_term = kwargs.get("search_term")
        if db is None or not user_id or not search_term:
            raise RuntimeError("Upwork search requires db, user_id and search_term")
        from .upwork_api import fetch_upwork_opportunities
        result = await fetch_upwork_opportunities(
            db, str(user_id), str(search_term), int(kwargs.get("limit", 20)), kwargs.get("cursor")
        )
        return result["items"]


class FreelancerAdapter(MarketplaceAdapter):
    provider = "freelancer"

    def status(self) -> AdapterStatus:
        return AdapterStatus(
            self.provider, False, (),
            "Freelancer provides an official developer API and sandbox, but this project has no verified credentials or implemented provider endpoints.",
        )


ADAPTERS: dict[str, MarketplaceAdapter] = {
    "upwork": UpworkAdapter(),
    "freelancer": FreelancerAdapter(),
}


def adapter_status(provider: str) -> dict[str, Any]:
    adapter = ADAPTERS.get(provider)
    if not adapter:
        return {"provider": provider, "enabled": False, "capabilities": [], "reason": "No official API adapter is registered"}
    status = adapter.status()
    return {"provider": status.provider, "enabled": status.enabled,
            "capabilities": list(status.capabilities), "reason": status.reason}

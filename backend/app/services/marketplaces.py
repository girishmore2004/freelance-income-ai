"""Marketplace capability registry.

This module intentionally exposes only documented, currently safe capabilities.
It does not scrape websites, automate browser sessions, or submit applications.
Provider-specific API clients must be added only after credentials and terms are verified.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class ProviderCapability:
    key: str
    display_name: str
    discovery_mode: str
    can_submit: bool
    documentation_url: str
    limitation: str


PROVIDERS = {
    "upwork": ProviderCapability(
        "upwork", "Upwork", "official_api_requires_approval", False,
        "https://www.upwork.com/developer/documentation/graphql/api/docs/index.html",
        "API key approval and account eligibility are controlled by Upwork; submission is not implemented here.",
    ),
    "freelancer": ProviderCapability(
        "freelancer", "Freelancer.com", "official_api_credentials_required", False,
        "https://developer.freelancer.com/",
        "Official developer API exists; provider credentials and endpoint-level implementation are still required.",
    ),
    "fiverr": ProviderCapability(
        "fiverr", "Fiverr", "manual_or_permitted_feed", False,
        "https://www.fiverr.com/",
        "No general-purpose public freelancer opportunity API is configured.",
    ),
    "linkedin": ProviderCapability(
        "linkedin", "LinkedIn", "manual_or_approved_partner", False,
        "https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access",
        "Job-related API products are restricted; no public job-search endpoint is enabled.",
    ),
    "manual": ProviderCapability(
        "manual", "Manual / saved search", "manual", False, "",
        "Manual entry and the existing RSS/Atom/public JSON discovery are supported.",
    ),
}


def get_provider(key: str) -> ProviderCapability:
    try:
        return PROVIDERS[key]
    except KeyError as exc:
        raise ValueError(f"Unsupported marketplace provider: {key}") from exc


def list_providers():
    return [vars(provider) for provider in PROVIDERS.values()]


def submission_allowed(provider: str) -> bool:
    """Fail closed: no v1.6 provider has an enabled submission adapter."""
    return get_provider(provider).can_submit

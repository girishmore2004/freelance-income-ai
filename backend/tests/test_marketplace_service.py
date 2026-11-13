from app.services.marketplaces import get_provider, list_providers, submission_allowed

def test_provider_catalog_is_fail_closed():
    assert {item["key"] for item in list_providers()} == {"upwork", "freelancer", "fiverr", "linkedin", "manual"}
    for provider in ("upwork", "freelancer", "fiverr", "linkedin", "manual"):
        assert submission_allowed(provider) is False

def test_unknown_provider_rejected():
    try:
        get_provider("unknown")
        assert False, "expected ValueError"
    except ValueError:
        pass

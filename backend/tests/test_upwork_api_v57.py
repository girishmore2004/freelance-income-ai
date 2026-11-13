import pytest
from fastapi import HTTPException
from app.services.upwork_api import map_upwork_job, fetch_upwork_opportunities, SEARCH_QUERY
from app.services.marketplace_adapters import adapter_status, ADAPTERS


def test_map_upwork_job_normalizes_documented_search_fields():
    item = map_upwork_job({
        "id": "job-123", "title": "Python automation developer",
        "description": "Build an automation workflow for reporting.",
        "amount": {"displayValue": "$850.00", "currency": "USD"},
        "skills": [{"name": "Python"}, {"name": "API Integration"}],
        "client": {"totalFeedback": 4.8, "totalReviews": 12, "totalHires": 8},
        "totalApplicants": 14, "publishedDateTime": "2026-11-12T10:00:00Z",
        "category": "Development & IT",
    })
    assert item["source"] == "upwork_api"
    assert item["external_id"] == "job-123"
    assert item["budget_min"] == 850.0 and item["budget_max"] == 850.0
    assert item["currency"] == "USD"
    assert item["required_skills"] == ["API Integration", "Python"]
    assert item["client_rating"] == 4.8
    assert item["competition_level"] == "medium"
    assert item["source_url"] == ""  # Never fabricate a browser URL.
    assert item["client_payment_verified"] is None


def test_map_upwork_hourly_job_and_missing_client_data():
    item = map_upwork_job({
        "id": "job-456", "title": "React frontend engineer",
        "description": "Implement a responsive dashboard interface.",
        "hourlyBudgetMin": {"displayValue": "$20.00", "currency": "USD"},
        "hourlyBudgetMax": {"displayValue": "$35.00", "currency": "USD"},
        "engagement": "Hourly",
    })
    assert item["job_type"] == "hourly"
    assert item["budget_min"] == 20.0 and item["budget_max"] == 35.0
    assert item["client_rating"] is None
    assert item["client_reviews"] is None


def test_map_rejects_records_without_stable_id_or_title():
    assert map_upwork_job({"id": "x", "title": ""}) is None
    assert map_upwork_job({"title": "A valid title"}) is None


def test_graphql_query_is_read_only_and_uses_official_search_field():
    assert "marketplaceJobPostingsSearch" in SEARCH_QUERY
    assert "mutation" not in SEARCH_QUERY.lower()
    assert "searchExpression_eq" not in SEARCH_QUERY  # Filter is sent as a variable.


def test_upwork_adapter_exposes_only_read_only_capability():
    status = adapter_status("upwork")
    assert status["enabled"] is True
    assert status["capabilities"] == ["read_only_opportunity_search"]
    assert "submission" in status["reason"].lower()


@pytest.mark.asyncio
async def test_upwork_adapter_requires_user_scoped_context():
    with pytest.raises(RuntimeError, match="requires db"):
        await ADAPTERS["upwork"].fetch_opportunities()


class EmptyDB:
    def scalar(self, statement):
        return None


@pytest.mark.asyncio
async def test_search_requires_connected_account():
    with pytest.raises(HTTPException) as exc:
        await fetch_upwork_opportunities(EmptyDB(), "user-1", "python", 10)
    assert exc.value.status_code == 409

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from app.services import upwork_api


class CredentialDB:
    def __init__(self, credential):
        self.credential = credential
    def scalar(self, statement):
        return self.credential
    def refresh(self, row):
        pass


@pytest.mark.asyncio
async def test_fetch_upwork_search_maps_results_and_pagination(monkeypatch):
    credential = SimpleNamespace(
        token_expires_at=datetime.now(timezone.utc) + timedelta(hours=2),
        status="stored_unverified",
    )
    db = CredentialDB(credential)
    monkeypatch.setattr(upwork_api, "load_tokens", lambda row: {"access_token": "secret-token", "refresh_token": ""})
    async def fake_request(token, term, limit, cursor):
        assert token == "secret-token"
        assert term == "python automation"
        assert limit == 10
        assert cursor == "cursor-1"
        return {"data": {"marketplaceJobPostingsSearch": {
            "totalCount": 45,
            "edges": [{"node": {"id": "job-1", "title": "Python automation developer",
                "description": "Automate recurring finance reports.",
                "amount": {"displayValue": "$500", "currency": "USD"},
                "skills": [{"name": "Python"}], "client": {"totalFeedback": 4.9, "totalReviews": 8},
                "totalApplicants": 5}}],
            "pageInfo": {"hasNextPage": True, "endCursor": "cursor-2"},
        }}}
    monkeypatch.setattr(upwork_api, "_graphql_request", fake_request)
    result = await upwork_api.fetch_upwork_opportunities(db, "user-1", "python automation", 10, "cursor-1")
    assert result["total_count"] == 45
    assert result["has_more"] is True
    assert result["next_cursor"] == "cursor-2"
    assert result["items"][0]["external_id"] == "job-1"
    assert result["items"][0]["budget_max"] == 500


@pytest.mark.asyncio
async def test_graphql_request_uses_bearer_and_default_user_organization(monkeypatch):
    captured = {}
    class Response:
        status_code = 200
        headers = {}
        def json(self):
            return {"data": {"marketplaceJobPostingsSearch": {"edges": [], "totalCount": 0}}}
    class Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): return False
        async def post(self, url, **kwargs):
            captured["url"] = url
            captured.update(kwargs)
            return Response()
    monkeypatch.setattr(upwork_api.httpx, "AsyncClient", lambda **kwargs: Client())
    body = await upwork_api._graphql_request("test-access-token", "python", 5, None)
    assert body["data"]
    assert captured["url"] == "https://api.upwork.com/graphql"
    assert captured["headers"]["Authorization"] == "Bearer test-access-token"
    assert "X-Upwork-API-TenantId" not in captured["headers"]
    assert captured["json"]["variables"]["filter"]["searchExpression_eq"] == "python"


@pytest.mark.asyncio
async def test_graphql_permission_errors_are_safe_and_actionable(monkeypatch):
    class Response:
        status_code = 200
        headers = {}
        def json(self):
            return {"errors": [{"message": "Insufficient OAuth scope permissions"}]}
    class Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): return False
        async def post(self, *args, **kwargs): return Response()
    monkeypatch.setattr(upwork_api.httpx, "AsyncClient", lambda **kwargs: Client())
    with pytest.raises(HTTPException) as exc:
        await upwork_api._graphql_request("access-token", "python", 5, None)
    assert exc.value.status_code == 409
    assert "scope" in exc.value.detail.lower()
    assert "access-token" not in exc.value.detail

from app.services.upwork_retention import expire_stale_upwork_listings


class RowsResult:
    def __init__(self, rows): self.rows = rows
    def all(self): return self.rows


class RetentionDB:
    def __init__(self, rows): self.rows = rows; self.statement = None
    def scalars(self, statement):
        self.statement = str(statement)
        self.params = statement.compile().params
        return RowsResult(self.rows)
    def flush(self): pass


def test_upwork_cache_expiration_redacts_provider_content():
    stale = SimpleNamespace(
        source="upwork_api", status="new", title="Private listing title",
        client_name="Client name", description="Private listing description",
        source_url="https://example.invalid/listing", budget_min=10, budget_max=20,
        currency="USD", required_skills='["Python"]', deadline="tomorrow",
        job_type="fixed", industry="IT", estimated_hours=4,
        competition_level="low", client_rating=4.9, client_reviews=20,
        client_payment_verified=True, match_score=90, score_breakdown='{"x":1}',
        source_fingerprint="fingerprint", published_at=datetime.now(timezone.utc),
        source_origins='["upwork_official_graphql_api"]',
    )
    db = RetentionDB([stale])
    expired = expire_stale_upwork_listings(db, now=datetime.now(timezone.utc))
    assert expired == 1
    assert stale.status == "expired"
    assert stale.title == "Expired Upwork listing"
    assert "Private listing description" not in stale.description
    assert stale.source_url == ""
    assert stale.budget_min is None and stale.budget_max is None
    assert stale.required_skills == "[]"
    assert stale.client_payment_verified is None
    assert stale.source_fingerprint is None


def test_upwork_cache_cleanup_query_is_source_scoped():
    db = RetentionDB([])
    assert expire_stale_upwork_listings(db) == 0
    assert "opportunities.source =" in db.statement
    assert "upwork_api" in db.params.values()
    assert "status" in db.statement

from app.services.discovery import upsert_discovered_opportunity


class RehydrateDB:
    def __init__(self, existing): self.calls = 0; self.existing = existing
    def scalar(self, statement):
        self.calls += 1
        return None if self.calls == 1 else self.existing
    def flush(self): pass


def test_expired_upwork_record_is_rehydrated_on_new_api_search():
    now = datetime.now(timezone.utc)
    old = SimpleNamespace(
        id="local-opportunity-1", user_id="user-1", source="upwork_api", external_id="job-123",
        status="expired", title="Expired Upwork listing", client_name="Upwork client",
        description="Cache expired", source_url="", budget_min=None, budget_max=None,
        currency="N/A", required_skills="[]", deadline="", job_type="unknown", industry="",
        estimated_hours=None, competition_level="unknown", client_rating=None, client_reviews=None,
        client_payment_verified=None, match_score=0, score_breakdown="{}", source_fingerprint=None,
        published_at=None, source_origins="[]", duplicate_count=0, first_seen_at=now,
        last_seen_at=now, created_at=now,
    )
    db = RehydrateDB(old)
    item = {
        "source": "upwork_api", "source_origin": "upwork_official_graphql_api",
        "external_id": "job-123", "title": "Python automation developer",
        "description": "Build an automation workflow for reporting.", "source_url": "",
        "budget_min": 800, "budget_max": 800, "currency": "USD",
        "required_skills": ["Python"], "job_type": "fixed", "published_at": "",
    }
    user = SimpleNamespace(id="user-1")
    row, is_new = upsert_discovered_opportunity(db, user, {"skills": ["Python"]}, item)
    assert row is old and is_new is False
    assert row.title == "Python automation developer"
    assert row.budget_max == 800
    assert row.status == "new"
    assert row.source_fingerprint


def test_map_does_not_invent_currency_or_competition_when_provider_omits_them():
    item = map_upwork_job({
        "id": "job-789", "title": "Data analyst for reporting",
        "description": "Prepare weekly reporting and analysis.",
    })
    assert item["currency"] == "N/A"
    assert item["competition_level"] == "unknown"
    assert item["client_payment_verified"] is None

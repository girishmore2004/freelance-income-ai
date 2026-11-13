import json
from app import connectors

class FakeResponse:
    headers = {"content-type": "application/json"}
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def raise_for_status(self): return None
    def iter_bytes(self):
        yield json.dumps({"jobs":[
            {"id":"job-1","title":"Python Engineer","description":"Build a data pipeline using Python.",
             "url":"https://jobs.example/job-1","company":"Example","skills":["Python","SQL"],
             "budget_min":"10000","budget_max":"20000","currency":"INR"}
        ]}).encode()

def test_json_connector_normalizes_common_job_fields(monkeypatch):
    monkeypatch.setattr(connectors, "validate_feed_url", lambda url: "jobs.example")
    monkeypatch.setattr(connectors.httpx, "stream", lambda *args, **kwargs: FakeResponse())
    rows = connectors.parse_json_api("https://jobs.example/api/jobs")
    assert len(rows) == 1
    assert rows[0]["source"] == "json_api"
    assert rows[0]["external_id"] == "job-1"
    assert rows[0]["required_skills"] == ["Python", "SQL"]
    assert rows[0]["budget_max"] == 20000.0

class TooLargeResponse(FakeResponse):
    def iter_bytes(self):
        yield b"x" * (5 * 1024 * 1024 + 1)

def test_json_connector_rejects_large_response(monkeypatch):
    monkeypatch.setattr(connectors, "validate_feed_url", lambda url: "jobs.example")
    monkeypatch.setattr(connectors.httpx, "stream", lambda *args, **kwargs: TooLargeResponse())
    try:
        connectors.parse_json_api("https://jobs.example/api/jobs")
    except connectors.ConnectorError as exc:
        assert "5 MB" in str(exc)
    else:
        raise AssertionError("Expected oversized response to be rejected")

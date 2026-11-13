from app.services.discovery import canonical_listing_url, listing_fingerprint, _parse_published

def test_canonical_url_removes_tracking_parameters_and_fragment():
    a = canonical_listing_url("https://Jobs.Example.com/listing/123?utm_source=mail&x=1#details")
    b = canonical_listing_url("https://jobs.example.com/listing/123?x=1")
    assert a == b

def test_fingerprint_is_stable_across_tracking_variants():
    a = listing_fingerprint({"source":"rss","external_id":"1",
        "source_url":"https://example.com/job/7?utm_campaign=test"})
    b = listing_fingerprint({"source":"json_api","external_id":"different",
        "source_url":"https://example.com/job/7"})
    assert a == b

def test_missing_url_uses_source_scoped_external_id():
    a = listing_fingerprint({"source":"rss","external_id":"job-1"})
    b = listing_fingerprint({"source":"json_api","external_id":"job-1"})
    assert a != b

def test_published_date_parser_accepts_rfc2822():
    value = _parse_published("Wed, 12 Nov 2026 10:00:00 +0000")
    assert value is not None
    assert value.year == 2026 and value.month == 11 and value.day == 12

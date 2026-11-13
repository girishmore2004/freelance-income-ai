from types import SimpleNamespace as NS
from app.services.revision_evidence_coverage import build_revision_evidence_coverage


def base(origin="client_requested", feedback_id="f1", scope_id=None):
    project = NS(id="p1", title="Website", user_id="u1")
    deliverable = NS(id="d1", project_id="p1", user_id="u1", title="Landing page")
    revision = NS(id="r1", user_id="u1", deliverable_id="d1", version=2,
                  revision_origin=origin, client_feedback_event_id=feedback_id,
                  scope_change_request_id=scope_id, content_hash="abc")
    return project, deliverable, revision


def test_client_feedback_link_must_match_revision_hash_and_decision():
    p, d, r = base()
    feedback = NS(id="f1", user_id="u1", deliverable_id="d1", revision_version=2,
                  content_hash="abc", decision="changes_requested")
    result = build_revision_evidence_coverage([p], [d], [r], [feedback], [])
    assert result["summary"]["evidence_coverage_percent"] == 100.0
    assert result["revisions"][0]["evidence_status"] == "matched"


def test_missing_required_feedback_is_not_counted_as_matched():
    p, d, r = base(feedback_id=None)
    result = build_revision_evidence_coverage([p], [d], [r], [], [])
    assert result["summary"]["missing_evidence_revisions"] == 1
    assert result["summary"]["evidence_coverage_percent"] == 0.0


def test_mismatched_feedback_hash_is_flagged():
    p, d, r = base()
    feedback = NS(id="f1", user_id="u1", deliverable_id="d1", revision_version=2,
                  content_hash="different", decision="changes_requested")
    result = build_revision_evidence_coverage([p], [d], [r], [feedback], [])
    assert result["summary"]["mismatched_evidence_revisions"] == 1


def test_scope_change_requires_same_project_and_explicit_client_acceptance():
    p, d, r = base(origin="approved_scope_change", feedback_id=None, scope_id="s1")
    scope = NS(id="s1", user_id="u1", project_id="p1", status="approved", client_accepted=True)
    result = build_revision_evidence_coverage([p], [d], [r], [], [scope])
    assert result["revisions"][0]["evidence_status"] == "matched"
    scope.project_id = "another-project"
    result = build_revision_evidence_coverage([p], [d], [r], [], [scope])
    assert result["revisions"][0]["evidence_status"] == "mismatched"


def test_unclassified_revisions_are_excluded_from_coverage_denominator():
    p, d, r = base(origin="unclassified", feedback_id=None)
    result = build_revision_evidence_coverage([p], [d], [r], [], [])
    assert result["summary"]["unclassified_revisions"] == 1
    assert result["summary"]["evidence_required_revisions"] == 0
    assert result["summary"]["evidence_coverage_percent"] is None


def test_wrong_evidence_record_type_is_mismatched():
    p, d, r = base(origin="client_requested", feedback_id=None, scope_id="s1")
    result = build_revision_evidence_coverage([p], [d], [r], [], [])
    assert result["revisions"][0]["evidence_status"] == "mismatched"

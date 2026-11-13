import hashlib
import io
import zipfile
from types import SimpleNamespace

from app.services.archive_outcomes import sha256_json
from app.services.archive_recovery import build_archive_bundle, build_verification_report


def test_verification_report_checks_source_layers_and_reference_strings():
    snapshot = {"project_id": "p1", "generated_at": "2026-11-13T10:00:00+00:00"}
    snapshot_hash = sha256_json(snapshot)
    components = {
        "handover_snapshot": {"id": "snap1", "version": 1, "sha256": snapshot_hash},
        "closeout_signoff": {"id": "sign1", "snapshot_hash": snapshot_hash, "fingerprint": "fp1"},
        "closure": {"id": "close1", "signoff_id": "sign1", "snapshot_hash": snapshot_hash, "fingerprint": "fp1"},
        "evidence_references": [
            {"kind": "test", "record_id": "e1", "reference": "ticket-123",
             "reference_sha256": hashlib.sha256(b"ticket-123").hexdigest()},
            {"kind": "test", "record_id": "e2"},
        ],
    }
    manifest = {"components": components, "component_sha256": sha256_json(components)}
    manifest_hash = sha256_json(manifest)
    signoff = SimpleNamespace(id="sign1", snapshot_id="snap1", snapshot_hash=snapshot_hash, closeout_fingerprint="fp1")
    closure = SimpleNamespace(signoff_id="sign1", snapshot_hash=snapshot_hash, closeout_fingerprint="fp1")
    report = build_verification_report(manifest, manifest_hash, snapshot, snapshot_hash, signoff, closure)
    assert report["valid"] is True
    assert report["checks"][0]["valid"] is True
    assert report["evidence_reference_checks"][0]["reference_sha256_valid"] is True
    assert report["evidence_reference_checks"][1]["reference_present"] is False


def test_verification_report_rejects_tampered_manifest_or_snapshot():
    snapshot = {"value": "original"}
    digest = sha256_json(snapshot)
    components = {"handover_snapshot": {"id": "s", "sha256": digest},
                  "closeout_signoff": {}, "closure": {}, "evidence_references": []}
    manifest = {"components": components, "component_sha256": sha256_json(components)}
    report = build_verification_report(manifest, "0" * 64, {"value": "tampered"}, digest, None, None)
    assert report["valid"] is False
    assert not all(item["valid"] for item in report["checks"])


def test_archive_bundle_contains_pdf_json_report_and_checksums_and_is_reproducible():
    manifest = {"components": {"handover_snapshot": {"id": "s1"}}}
    report = {"valid": True, "checks": []}
    kwargs = (manifest, "m1", 2, "a" * 64, {"hello": "world"}, b"%PDF-test", report, {"net_recorded_cash": 100})
    first = build_archive_bundle(*kwargs)
    second = build_archive_bundle(*kwargs)
    assert first == second
    with zipfile.ZipFile(io.BytesIO(first)) as archive:
        names = set(archive.namelist())
        assert {"manifest.json", "approved-handover/snapshot.json",
                "approved-handover/handover.pdf", "verification/verification-report.json",
                "README.txt", "SHA256SUMS.txt", "outcome-review.json"} <= names
        for line in archive.read("SHA256SUMS.txt").decode().strip().splitlines():
            digest, name = line.split("  ", 1)
            assert hashlib.sha256(archive.read(name)).hexdigest() == digest


def test_v541_route_registration_and_single_migration_head():
    from pathlib import Path
    root = Path(__file__).parents[1]
    main = (root / "app" / "main.py").read_text()
    for route in (
        '/api/v1/archive-manifests/{manifest_id}/verification-report',
        '/api/v1/archive-manifests/{manifest_id}/evidence-report',
        '/api/v1/archive-manifests/{manifest_id}/bundle.zip',
        '/api/v1/archive-manifests/{manifest_id}/supersede',
        '/api/v1/projects/{project_id}/archive-supersessions',
        '/api/v1/projects/{project_id}/recovery-rehearsals',
    ):
        assert route in main
    assert main.count('@app.get("/api/v1/archive-manifests/{manifest_id}/evidence-report")') == 1
    migration = (root / "alembic" / "versions" / "0043_archive_bundle_and_supersession.py").read_text()
    assert 'down_revision = "0042_post_closeout_archive_and_retention"' in migration
    assert not (root / "alembic" / "versions" / "0043_archive_bundle_supersession_recovery.py").exists()


def test_archive_api_verification_includes_live_source_reference_comparison():
    from pathlib import Path
    main = (Path(__file__).parents[1] / "app" / "main.py").read_text()
    assert "build_evidence_reference_report(payload" in main
    assert 'report["source_evidence_reference_report"] = source_evidence_report' in main
    assert 'report["valid"] = bool(report["valid"] and source_evidence_report["all_reference_texts_match"])' in main
    assert '"X-Archive-Bundle-SHA256": hashlib.sha256(content).hexdigest()' in main


def test_recovery_rehearsal_requires_human_evidence_for_completed_checks():
    from pathlib import Path
    main = (Path(__file__).parents[1] / "app" / "main.py").read_text()
    assert 'if item["completed"] and len(evidence) < 5:' in main
    assert 'The checklist records human-reported recovery steps' in main

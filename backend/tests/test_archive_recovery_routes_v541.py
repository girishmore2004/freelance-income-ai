
from pathlib import Path


def test_v541_archive_recovery_routes_are_present():
    root = Path(__file__).parents[1]
    main = (root / "app" / "main.py").read_text()

    required = [
        '@app.get("/api/v1/archive-manifests/{manifest_id}/verification-report")',
        '@app.get("/api/v1/archive-manifests/{manifest_id}/evidence-report")',
        '@app.get("/api/v1/archive-manifests/{manifest_id}/bundle.zip")',
        '@app.post("/api/v1/archive-manifests/{manifest_id}/supersede")',
        '@app.get("/api/v1/projects/{project_id}/archive-supersessions")',
        '@app.get("/api/v1/archive-manifests/{manifest_id}/recovery-checklist")',
        '@app.post("/api/v1/projects/{project_id}/recovery-rehearsals")',
        '@app.get("/api/v1/projects/{project_id}/recovery-rehearsals")',
    ]

    for route in required:
        assert route in main


def test_v541_migration_follows_v540_and_creates_both_tables():
    root = Path(__file__).parents[1]

    migration = (
        root
        / "alembic"
        / "versions"
        / "0043_archive_bundle_and_supersession.py"
    ).read_text()

    assert 'revision = "0043_archive_supersession"' in migration
    assert 'down_revision = "0042_archive_retention"' in migration
    assert '"archive_supersession_records"' in migration
    assert '"project_recovery_rehearsals"' in migration


from pathlib import Path


def test_archive_and_retention_routes_are_registered_in_application_source():
    main = (
        Path(__file__).parents[1] / "app" / "main.py"
    ).read_text()

    required = [
        '@app.post("/api/v1/projects/{project_id}/archive-manifests")',
        '@app.get("/api/v1/projects/{project_id}/archive-manifests")',
        '@app.get("/api/v1/archive-manifests/{manifest_id}/verify")',
        '@app.get("/api/v1/archive-manifests/{manifest_id}/download")',
        '@app.get("/api/v1/projects/{project_id}/outcome-review")',
        '@app.get("/api/v1/retention-policy")',
        '@app.post("/api/v1/retention-policy/reviews")',
        '@app.post("/api/v1/retention-policy/reviews/{review_id}/decide")',
    ]

    for route in required:
        assert route in main


def test_archive_migration_follows_closeout_signoff_migration():
    migration = (
        Path(__file__).parents[1]
        / "alembic"
        / "versions"
        / "0042_post_closeout_archive_and_retention.py"
    ).read_text()

    assert 'revision = "0042_archive_retention"' in migration
    assert 'down_revision = "0041_closeout_signoff"' in migration

    assert '"delivery_archive_manifests"' in migration
    assert '"project_retention_policies"' in migration
    assert '"project_retention_reviews"' in migration

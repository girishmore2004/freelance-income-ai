from pathlib import Path

ROOT = Path(__file__).parents[1]


def test_sensitive_mfa_mutations_lock_account_before_state_checks():
    source = (ROOT / "app" / "main.py").read_text()
    assert "def _lock_security_user(db: Session, user_id: str) -> User:" in source
    assert "select(User).where(User.id == user_id).with_for_update()" in source
    routes = (
        'def setup_mfa(', 'def enable_mfa(', 'def disable_mfa(',
        'def rotate_mfa_recovery_codes(',
    )
    for route in routes:
        start = source.index(route)
        body = source[start:source.index("\n\n@app.", start)]
        assert "user = _lock_security_user(db, user.id)" in body


def test_cross_account_regression_suites_are_present():
    tests = Path(__file__).parent
    assert (tests / "test_tenant_isolation_v32.py").is_file()
    assert (tests / "test_tenant_isolation_v38.py").is_file()
    assert (tests / "test_tenant_isolation_v39.py").is_file()


def test_backup_restore_scripts_have_nonproduction_and_checksum_guards():
    ops = ROOT.parent / "ops"
    backup = (ops / "backup_postgres.sh").read_text()
    restore = (ops / "restore_postgres.sh").read_text()
    verify = (ops / "verify_backup_restore.sh").read_text()
    assert "sha256sum" in backup and "pg_restore --list" in backup
    assert 'CONFIRM_RESTORE:-' in restore and '!= "YES"' in restore
    assert 'ALLOW_NONPRODUCTION_RESTORE:-' in verify
    assert 'RESTORE_DATABASE_URL' in verify and 'DATABASE_URL' in verify
    assert "--single-transaction" in restore


def test_full_ci_has_database_migrations_tests_frontend_and_dependency_audit():
    workflow = (ROOT.parent / ".github" / "workflows" / "full-ci.yml").read_text()
    for expected in (
        "alembic upgrade head", "pytest -q", "npm run typecheck",
        "npm run build", "pip-audit", "npm audit", "pgvector/pgvector:pg16",
    ):
        assert expected in workflow


def test_release_version_and_health_endpoint_are_aligned():
    project = ROOT.parent
    assert (project / "VERSION").read_text().strip() == "5.45.0"
    main = (ROOT / "app" / "main.py").read_text()
    assert 'version="5.45.0"' in main
    assert '"version":"5.45.0"' in main
    assert 'revision = "0045_mfa_and_login_lockout"' in (ROOT / "alembic" / "versions" / "0045_mfa_and_login_lockout.py").read_text()

"""Migration 0066 marks F11 Business Coach partial (data-only)."""
import pathlib
import runpy

MIGRATION = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0066_business_coach_partial.py"


def test_marks_only_f11_and_only_from_planned():
    source = MIGRATION.read_text()
    namespace = runpy.run_path(str(MIGRATION), run_name="migration_under_test")
    assert namespace["PARTIAL"] == {"F11": ["business_coach"]}
    assert "AND status = 'planned'" in source
    assert 'down_revision = "0065_contract_files"' in source

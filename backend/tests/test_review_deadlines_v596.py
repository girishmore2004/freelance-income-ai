"""Migration 0080: review extensions for service-order deliveries (U29)."""
import importlib.util
import pathlib

from app import models

BACKEND = pathlib.Path(__file__).resolve().parents[1]
PATH = BACKEND / "alembic" / "versions" / "0080_review_deadlines.py"


def _module():
    spec = importlib.util.spec_from_file_location("m0080", PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


def test_revision_chain():
    m = _module()
    assert m.revision == "0080_review_deadlines"
    assert m.down_revision == "0079_agents_complete"
    assert len(m.revision) <= 32


def test_model_has_the_column_with_a_safe_default():
    col = models.MilestoneSubmission.__table__.c.review_extensions
    assert col.nullable is False
    assert str(col.server_default.arg) == "0"


def test_head_pin():
    assert 'EXPECTED_MIGRATION_HEAD = "0080_review_deadlines"' in (BACKEND / "app" / "main.py").read_text()

"""Migration 0078: client proposal cap / closing, and freelancer–client blocks (U23)."""
import importlib.util
import pathlib

from app import models

BACKEND = pathlib.Path(__file__).resolve().parents[1]
PATH = BACKEND / "alembic" / "versions" / "0078_fair_proposals_blocks.py"


def _module():
    spec = importlib.util.spec_from_file_location("m0078", PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


def test_revision_chain():
    m = _module()
    assert m.revision == "0078_fair_proposals_blocks"
    assert m.down_revision == "0077_agent_registry_refresh"
    assert len(m.revision) <= 32  # alembic_version.version_num is VARCHAR(32)


def test_models_match_the_migration():
    listing = models.ProjectListing.__table__
    assert "max_proposals" in listing.c and listing.c.max_proposals.nullable
    assert "proposals_closed_at" in listing.c and listing.c.proposals_closed_at.nullable
    blocks = models.MarketplaceBlock.__table__
    assert {c.name for c in blocks.c} == {"id", "freelancer_user_id", "organization_id", "blocked_by", "created_by_user_id", "reason", "created_at"}
    names = {c.name for c in blocks.constraints if c.name}
    assert {"ck_marketplace_blocks_side", "uq_marketplace_blocks_pair"} <= names
    # Deleting a user or an organisation removes its blocks; deleting the creator keeps the block.
    fks = {fk.parent.name: fk.ondelete for fk in blocks.foreign_keys}
    assert fks == {"freelancer_user_id": "CASCADE", "organization_id": "CASCADE", "created_by_user_id": "SET NULL"}


def test_head_pin():
    # Later migrations move the head; the next one must exist.
    assert (BACKEND / "alembic" / "versions" / "0079_agents_complete.py").exists()

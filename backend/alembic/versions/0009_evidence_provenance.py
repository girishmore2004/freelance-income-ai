"""Add evidence provenance metadata."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0009_evidence_provenance"
down_revision = "0008_source_health"
branch_labels = None
depends_on = None

def upgrade():
    existing = {c["name"] for c in inspect(op.get_bind()).get_columns("client_research")}
    if "source_host" not in existing:
        op.add_column("client_research", sa.Column("source_host", sa.String(255), nullable=False, server_default=""))
    if "evidence_hash" not in existing:
        op.add_column("client_research", sa.Column("evidence_hash", sa.String(64), nullable=False, server_default=""))

def downgrade():
    existing = {c["name"] for c in inspect(op.get_bind()).get_columns("client_research")}
    if "evidence_hash" in existing:
        op.drop_column("client_research", "evidence_hash")
    if "source_host" in existing:
        op.drop_column("client_research", "source_host")

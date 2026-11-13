"""Add multi-source provenance and freshness metadata."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0006_discovery_freshness"
down_revision = "0005_client_risk"
branch_labels = None
depends_on = None

def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {c["name"] for c in inspector.get_columns("opportunities")}
    additions = [
        ("source_fingerprint", sa.String(64), True),
        ("first_seen_at", sa.DateTime(timezone=True), True),
        ("last_seen_at", sa.DateTime(timezone=True), True),
        ("published_at", sa.DateTime(timezone=True), True),
        ("duplicate_count", sa.Integer(), False),
        ("source_origins", sa.Text(), False),
    ]
    for name, column_type, nullable in additions:
        if name not in columns:
            if name == "duplicate_count":
                op.add_column("opportunities", sa.Column(name, column_type, nullable=False, server_default="0"))
            elif name == "source_origins":
                op.add_column("opportunities", sa.Column(name, column_type, nullable=False, server_default="[]"))
            else:
                op.add_column("opportunities", sa.Column(name, column_type, nullable=True))
    inspector = inspect(bind)
    indexes = {i["name"] for i in inspector.get_indexes("opportunities")}
    if "ix_opportunities_source_fingerprint" not in indexes:
        op.create_index("ix_opportunities_source_fingerprint", "opportunities", ["source_fingerprint"])
    if "ix_opportunities_last_seen_at" not in indexes:
        op.create_index("ix_opportunities_last_seen_at", "opportunities", ["last_seen_at"])

def downgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    indexes = {i["name"] for i in inspector.get_indexes("opportunities")}
    for name in ("ix_opportunities_last_seen_at", "ix_opportunities_source_fingerprint"):
        if name in indexes:
            op.drop_index(name, table_name="opportunities")
    columns = {c["name"] for c in inspect(bind).get_columns("opportunities")}
    for name in ("source_origins", "duplicate_count", "published_at", "last_seen_at", "first_seen_at", "source_fingerprint"):
        if name in columns:
            op.drop_column("opportunities", name)

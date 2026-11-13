"""Add native pgvector storage for portfolio embeddings."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from pgvector.sqlalchemy import Vector

revision = "0003_pgvector"
down_revision = "0002_jobs_chunks"
branch_labels = None
depends_on = None

def upgrade():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")
        inspector = inspect(bind)
        if "embedding_vector" not in {c["name"] for c in inspector.get_columns("portfolio_chunks")}:
            op.add_column(
                "portfolio_chunks",
                sa.Column("embedding_vector", Vector(), nullable=True),
            )
        # Backfill native vectors from the v0.3 JSON representation.
        rows = bind.execute(sa.text(
            "SELECT id, embedding_json FROM portfolio_chunks "
            "WHERE embedding_json IS NOT NULL AND embedding_json <> '[]'"
        )).fetchall()
        for row in rows:
            try:
                import json
                vector = json.loads(row.embedding_json)
                if vector:
                    bind.execute(
                        sa.text("UPDATE portfolio_chunks SET embedding_vector = :v WHERE id = :id"),
                        {"v": str(vector), "id": row.id},
                    )
            except Exception:
                continue
    else:
        inspector = inspect(bind)
        if "embedding_vector" not in {c["name"] for c in inspector.get_columns("portfolio_chunks")}:
            op.add_column(
                "portfolio_chunks",
                sa.Column("embedding_vector", sa.JSON(), nullable=True),
            )

def downgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    if "embedding_vector" in {c["name"] for c in inspector.get_columns("portfolio_chunks")}:
        op.drop_column("portfolio_chunks", "embedding_vector")

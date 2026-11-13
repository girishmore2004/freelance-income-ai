"""Add background job tracking and portfolio chunks."""
from alembic import op
from sqlalchemy import inspect
from app.database import Base
from app import models

revision = "0002_jobs_chunks"
down_revision = "0001_initial"
branch_labels = None
depends_on = None

def upgrade():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    inspector = inspect(bind)
    for table_name in ("background_jobs", "portfolio_chunks"):
        if table_name not in inspector.get_table_names():
            Base.metadata.tables[table_name].create(bind=bind, checkfirst=True)

def downgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    for table_name in ("portfolio_chunks", "background_jobs"):
        if table_name in inspector.get_table_names():
            Base.metadata.tables[table_name].drop(bind=bind, checkfirst=True)

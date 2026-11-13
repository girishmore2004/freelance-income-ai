"""Add freelancer preference and opportunity scoring fields."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0004_profile_match"
down_revision = "0003_pgvector"
branch_labels = None
depends_on = None

def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    existing = {table: {c["name"] for c in inspector.get_columns(table)}
                for table in ("profiles", "opportunities")}
    profile_columns = [
        sa.Column("hourly_rate", sa.Float(), nullable=False, server_default="0"),
        sa.Column("timezone", sa.String(80), nullable=False, server_default="Asia/Kolkata"),
        sa.Column("preferred_work_types", sa.Text(), nullable=False, server_default='["fixed", "hourly"]'),
        sa.Column("preferred_industries", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("dealbreakers", sa.Text(), nullable=False, server_default="[]"),
    ]
    opportunity_columns = [
        sa.Column("job_type", sa.String(30), nullable=False, server_default="unknown"),
        sa.Column("industry", sa.String(100), nullable=False, server_default=""),
        sa.Column("estimated_hours", sa.Float(), nullable=True),
        sa.Column("competition_level", sa.String(20), nullable=False, server_default="unknown"),
        sa.Column("client_rating", sa.Float(), nullable=True),
        sa.Column("client_reviews", sa.Integer(), nullable=True),
        sa.Column("client_payment_verified", sa.Boolean(), nullable=True),
    ]
    for column in profile_columns:
        if column.name not in existing["profiles"]:
            op.add_column("profiles", column)
    for column in opportunity_columns:
        if column.name not in existing["opportunities"]:
            op.add_column("opportunities", column)

def downgrade():
    op.drop_column("opportunities", "client_payment_verified")
    op.drop_column("opportunities", "client_reviews")
    op.drop_column("opportunities", "client_rating")
    op.drop_column("opportunities", "competition_level")
    op.drop_column("opportunities", "estimated_hours")
    op.drop_column("opportunities", "industry")
    op.drop_column("opportunities", "job_type")
    op.drop_column("profiles", "dealbreakers")
    op.drop_column("profiles", "preferred_industries")
    op.drop_column("profiles", "preferred_work_types")
    op.drop_column("profiles", "timezone")
    op.drop_column("profiles", "hourly_rate")

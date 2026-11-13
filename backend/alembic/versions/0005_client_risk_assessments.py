"""Persist client risk assessment reports."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0005_client_risk"
down_revision = "0004_profile_match"
branch_labels = None
depends_on = None

def upgrade():
    bind = op.get_bind()
    if "client_risk_assessments" not in inspect(bind).get_table_names():
        op.create_table(
            "client_risk_assessments",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("opportunity_id", sa.String(36), sa.ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False),
            sa.Column("risk_score", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("risk_level", sa.String(30), nullable=False, server_default="insufficient_data"),
            sa.Column("evidence_coverage", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("report_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_client_risk_assessments_user_id", "client_risk_assessments", ["user_id"])
        op.create_index("ix_client_risk_assessments_opportunity_id", "client_risk_assessments", ["opportunity_id"])

def downgrade():
    bind = op.get_bind()
    if "client_risk_assessments" in inspect(bind).get_table_names():
        op.drop_index("ix_client_risk_assessments_opportunity_id", table_name="client_risk_assessments")
        op.drop_index("ix_client_risk_assessments_user_id", table_name="client_risk_assessments")
        op.drop_table("client_risk_assessments")

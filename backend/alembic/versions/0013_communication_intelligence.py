"""Add message intelligence and grounded email draft metadata."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0013_communication_intelligence"
down_revision = "0012_email_provider_oauth"
branch_labels = None
depends_on = None

def upgrade():
    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    if "client_emails" in tables:
        cols = {c["name"] for c in inspect(bind).get_columns("client_emails")}
        additions = [
            ("sentiment", sa.String(20), False, "neutral"),
            ("sentiment_evidence", sa.Text(), False, "[]"),
            ("urgency", sa.String(20), False, "low"),
            ("urgency_score", sa.Integer(), False, "0"),
            ("urgency_reasons", sa.Text(), False, "[]"),
            ("suggested_project_id", sa.String(36), True, None),
            ("suggested_project_score", sa.Float(), False, "0"),
            ("analysis_version", sa.String(40), False, "rules-v1"),
        ]
        for name, typ, nullable, default in additions:
            if name not in cols:
                kwargs = {"nullable": nullable}
                if default is not None:
                    kwargs["server_default"] = default
                op.add_column("client_emails", sa.Column(name, typ, **kwargs))
    if "email_drafts" in tables:
        cols = {c["name"] for c in inspect(bind).get_columns("email_drafts")}
        for name, typ, default in [
            ("context_sources", sa.Text(), "[]"),
            ("generation_mode", sa.String(40), "safe_template"),
            ("grounding_note", sa.Text(), ""),
        ]:
            if name not in cols:
                op.add_column("email_drafts", sa.Column(name, typ, nullable=False, server_default=default))

def downgrade():
    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    if "email_drafts" in tables:
        cols = {c["name"] for c in inspect(bind).get_columns("email_drafts")}
        for name in ("grounding_note", "generation_mode", "context_sources"):
            if name in cols:
                op.drop_column("email_drafts", name)
    if "client_emails" in tables:
        cols = {c["name"] for c in inspect(bind).get_columns("client_emails")}
        for name in ("analysis_version", "suggested_project_score", "suggested_project_id",
                     "urgency_reasons", "urgency_score", "urgency", "sentiment_evidence", "sentiment"):
            if name in cols:
                op.drop_column("client_emails", name)

"""Add encrypted email provider accounts and OAuth state; bind approvals to recipient."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0012_email_provider_oauth"
down_revision = "0011_email_intake"
branch_labels = None
depends_on = None

def upgrade():
    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    if "email_oauth_states" not in tables:
        op.create_table(
            "email_oauth_states",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("provider", sa.String(20), nullable=False),
            sa.Column("state_hash", sa.String(64), nullable=False),
            sa.Column("code_verifier", sa.Text(), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("used_at", sa.DateTime(timezone=True)),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_email_oauth_states_user_id", "email_oauth_states", ["user_id"])
        op.create_index("ix_email_oauth_states_provider", "email_oauth_states", ["provider"])
        op.create_index("ix_email_oauth_states_state_hash", "email_oauth_states", ["state_hash"], unique=True)
        op.create_index("ix_email_oauth_states_expires_at", "email_oauth_states", ["expires_at"])
    if "email_provider_accounts" not in tables:
        op.create_table(
            "email_provider_accounts",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("provider", sa.String(20), nullable=False),
            sa.Column("provider_email", sa.String(320), nullable=False, server_default=""),
            sa.Column("access_token_encrypted", sa.Text(), nullable=False),
            sa.Column("refresh_token_encrypted", sa.Text(), nullable=False, server_default=""),
            sa.Column("token_expires_at", sa.DateTime(timezone=True)),
            sa.Column("scopes", sa.Text(), nullable=False, server_default=""),
            sa.Column("status", sa.String(20), nullable=False, server_default="connected"),
            sa.Column("last_synced_at", sa.DateTime(timezone=True)),
            sa.Column("last_sync_error", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("user_id", "provider", name="uq_email_provider_user"),
        )
        op.create_index("ix_email_provider_accounts_user_id", "email_provider_accounts", ["user_id"])
        op.create_index("ix_email_provider_accounts_provider", "email_provider_accounts", ["provider"])
    email_columns = {c["name"] for c in inspect(bind).get_columns("client_emails")}
    if "rfc_message_id" not in email_columns:
        op.add_column("client_emails", sa.Column("rfc_message_id", sa.String(998), nullable=False, server_default=""))
    if "external_fingerprint" not in email_columns:
        op.add_column("client_emails", sa.Column("external_fingerprint", sa.String(64), nullable=True))
        op.create_index("ix_client_emails_external_fingerprint", "client_emails", ["external_fingerprint"], unique=True)
    if "provider_verified" not in email_columns:
        op.add_column("client_emails", sa.Column("provider_verified", sa.Boolean(), nullable=False, server_default=sa.false()))
    draft_columns = {c["name"] for c in inspect(bind).get_columns("email_drafts")}
    if "sent_at" not in draft_columns:
        op.add_column("email_drafts", sa.Column("sent_at", sa.DateTime(timezone=True)))
    if "sent_provider_id" not in draft_columns:
        op.add_column("email_drafts", sa.Column("sent_provider_id", sa.String(255), nullable=False, server_default=""))
    if "approved_recipient" not in draft_columns:
        op.add_column("email_drafts", sa.Column("approved_recipient", sa.String(320), nullable=False, server_default=""))
    if "approved_provider" not in draft_columns:
        op.add_column("email_drafts", sa.Column("approved_provider", sa.String(20), nullable=False, server_default=""))

def downgrade():
    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    if "email_drafts" in tables:
        columns = {c["name"] for c in inspect(bind).get_columns("email_drafts")}
        for name in ("approved_provider", "approved_recipient", "sent_provider_id", "sent_at"):
            if name in columns:
                op.drop_column("email_drafts", name)
    if "client_emails" in tables:
        columns = {c["name"] for c in inspect(bind).get_columns("client_emails")}
        if "provider_verified" in columns:
            op.drop_column("client_emails", "provider_verified")
        if "external_fingerprint" in columns:
            op.drop_index("ix_client_emails_external_fingerprint", table_name="client_emails")
            op.drop_column("client_emails", "external_fingerprint")
        if "rfc_message_id" in columns:
            op.drop_column("client_emails", "rfc_message_id")
    if "email_provider_accounts" in tables:
        op.drop_table("email_provider_accounts")
    if "email_oauth_states" in tables:
        op.drop_table("email_oauth_states")

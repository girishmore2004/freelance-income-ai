"""Add client email intake, reply approvals and follow-up reminders."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
revision = "0011_email_intake"
down_revision = "0010_delivery_revenue"
branch_labels = None
depends_on = None
def upgrade():
    bind=op.get_bind(); tables=set(inspect(bind).get_table_names())
    if "client_emails" not in tables:
        op.create_table("client_emails", sa.Column("id",sa.String(36),primary_key=True), sa.Column("user_id",sa.String(36),sa.ForeignKey("users.id",ondelete="CASCADE"),nullable=False), sa.Column("opportunity_id",sa.String(36),sa.ForeignKey("opportunities.id",ondelete="SET NULL")), sa.Column("project_id",sa.String(36),sa.ForeignKey("projects.id",ondelete="SET NULL")), sa.Column("provider",sa.String(40),nullable=False,server_default="manual"), sa.Column("external_id",sa.String(255),nullable=False,server_default=""), sa.Column("thread_id",sa.String(255),nullable=False,server_default=""), sa.Column("sender_name",sa.String(200),nullable=False,server_default=""), sa.Column("sender_email",sa.String(320),nullable=False,server_default=""), sa.Column("subject",sa.String(500),nullable=False,server_default=""), sa.Column("body_text",sa.Text(),nullable=False), sa.Column("received_at",sa.DateTime(timezone=True),nullable=False), sa.Column("category",sa.String(40),nullable=False,server_default="general"), sa.Column("priority",sa.String(20),nullable=False,server_default="normal"), sa.Column("status",sa.String(30),nullable=False,server_default="new"), sa.Column("created_at",sa.DateTime(timezone=True),nullable=False))
        op.create_index("ix_client_emails_user_id","client_emails",["user_id"]); op.create_index("ix_client_emails_opportunity_id","client_emails",["opportunity_id"]); op.create_index("ix_client_emails_project_id","client_emails",["project_id"])
    if "email_drafts" not in tables:
        op.create_table("email_drafts",sa.Column("id",sa.String(36),primary_key=True),sa.Column("user_id",sa.String(36),sa.ForeignKey("users.id",ondelete="CASCADE"),nullable=False),sa.Column("email_id",sa.String(36),sa.ForeignKey("client_emails.id",ondelete="CASCADE"),nullable=False),sa.Column("subject",sa.String(500),nullable=False,server_default=""),sa.Column("body_text",sa.Text(),nullable=False),sa.Column("status",sa.String(30),nullable=False,server_default="draft"),sa.Column("approval_note",sa.Text(),nullable=False,server_default=""),sa.Column("approval_hash",sa.String(64),nullable=False,server_default=""),sa.Column("created_at",sa.DateTime(timezone=True),nullable=False),sa.Column("decided_at",sa.DateTime(timezone=True)))
        op.create_index("ix_email_drafts_user_id","email_drafts",["user_id"]); op.create_index("ix_email_drafts_email_id","email_drafts",["email_id"])
    if "follow_up_reminders" not in tables:
        op.create_table("follow_up_reminders",sa.Column("id",sa.String(36),primary_key=True),sa.Column("user_id",sa.String(36),sa.ForeignKey("users.id",ondelete="CASCADE"),nullable=False),sa.Column("email_id",sa.String(36),sa.ForeignKey("client_emails.id",ondelete="SET NULL")),sa.Column("project_id",sa.String(36),sa.ForeignKey("projects.id",ondelete="SET NULL")),sa.Column("title",sa.String(240),nullable=False),sa.Column("notes",sa.Text(),nullable=False,server_default=""),sa.Column("due_at",sa.DateTime(timezone=True),nullable=False),sa.Column("status",sa.String(20),nullable=False,server_default="open"),sa.Column("created_at",sa.DateTime(timezone=True),nullable=False))
        op.create_index("ix_follow_up_reminders_user_id","follow_up_reminders",["user_id"]); op.create_index("ix_follow_up_reminders_email_id","follow_up_reminders",["email_id"]); op.create_index("ix_follow_up_reminders_project_id","follow_up_reminders",["project_id"]); op.create_index("ix_follow_up_reminders_due_at","follow_up_reminders",["due_at"])
def downgrade():
    bind=op.get_bind(); tables=set(inspect(bind).get_table_names())
    for name in ("follow_up_reminders","email_drafts","client_emails"):
        if name in tables: op.drop_table(name)

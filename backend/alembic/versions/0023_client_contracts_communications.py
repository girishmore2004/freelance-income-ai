"""Add client contracts and communication timeline."""
from alembic import op
import sqlalchemy as sa
revision = "0023_client_ops"
down_revision = "0022_client_crm_scope"
branch_labels = None
depends_on = None
def upgrade():
    op.create_table("client_contracts",
        sa.Column("id",sa.String(36),primary_key=True),
        sa.Column("user_id",sa.String(36),sa.ForeignKey("users.id",ondelete="CASCADE"),nullable=False),
        sa.Column("client_id",sa.String(36),sa.ForeignKey("clients.id",ondelete="CASCADE"),nullable=False),
        sa.Column("project_id",sa.String(36),sa.ForeignKey("projects.id",ondelete="SET NULL"),nullable=True),
        sa.Column("title",sa.String(240),nullable=False),sa.Column("contract_type",sa.String(30),nullable=False,server_default="statement_of_work"),
        sa.Column("version",sa.Integer(),nullable=False,server_default="1"),sa.Column("content",sa.Text(),nullable=False),
        sa.Column("content_hash",sa.String(64),nullable=False,server_default=""),sa.Column("status",sa.String(30),nullable=False,server_default="draft"),
        sa.Column("currency",sa.String(8),nullable=False,server_default="INR"),sa.Column("value",sa.Float(),nullable=False,server_default="0"),
        sa.Column("expires_on",sa.String(10),nullable=False,server_default=""),sa.Column("decision_note",sa.Text(),nullable=False,server_default=""),
        sa.Column("created_at",sa.DateTime(timezone=True),nullable=False),sa.Column("updated_at",sa.DateTime(timezone=True),nullable=False))
    op.create_index("ix_client_contracts_user_id","client_contracts",["user_id"]);op.create_index("ix_client_contracts_client_id","client_contracts",["client_id"]);op.create_index("ix_client_contracts_project_id","client_contracts",["project_id"])
    op.create_table("client_communication_logs",sa.Column("id",sa.String(36),primary_key=True),
        sa.Column("user_id",sa.String(36),sa.ForeignKey("users.id",ondelete="CASCADE"),nullable=False),
        sa.Column("client_id",sa.String(36),sa.ForeignKey("clients.id",ondelete="CASCADE"),nullable=False),
        sa.Column("project_id",sa.String(36),sa.ForeignKey("projects.id",ondelete="SET NULL"),nullable=True),
        sa.Column("channel",sa.String(30),nullable=False,server_default="note"),sa.Column("direction",sa.String(20),nullable=False,server_default="internal"),
        sa.Column("subject",sa.String(300),nullable=False,server_default=""),sa.Column("body",sa.Text(),nullable=False),
        sa.Column("occurred_at",sa.DateTime(timezone=True),nullable=False),sa.Column("created_at",sa.DateTime(timezone=True),nullable=False))
    op.create_index("ix_client_communication_logs_user_id","client_communication_logs",["user_id"]);op.create_index("ix_client_communication_logs_client_id","client_communication_logs",["client_id"]);op.create_index("ix_client_communication_logs_project_id","client_communication_logs",["project_id"])
def downgrade():
    for name in ("ix_client_communication_logs_project_id","ix_client_communication_logs_client_id","ix_client_communication_logs_user_id"): op.drop_index(name,table_name="client_communication_logs")
    op.drop_table("client_communication_logs")
    for name in ("ix_client_contracts_project_id","ix_client_contracts_client_id","ix_client_contracts_user_id"): op.drop_index(name,table_name="client_contracts")
    op.drop_table("client_contracts")

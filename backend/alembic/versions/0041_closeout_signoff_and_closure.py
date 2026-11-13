"""Add immutable closeout sign-offs and explicit project closure records."""
from alembic import op
import sqlalchemy as sa
revision = "0041_closeout_signoff_and_closure"
down_revision = "0040_delivery_handover_snapshots"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("delivery_closeout_signoffs",
        sa.Column("id",sa.String(36),primary_key=True),
        sa.Column("user_id",sa.String(36),sa.ForeignKey("users.id",ondelete="CASCADE"),nullable=False),
        sa.Column("project_id",sa.String(36),sa.ForeignKey("projects.id",ondelete="CASCADE"),nullable=False),
        sa.Column("snapshot_id",sa.String(36),sa.ForeignKey("delivery_handover_snapshots.id",ondelete="RESTRICT"),nullable=False),
        sa.Column("version",sa.Integer(),nullable=False),sa.Column("snapshot_hash",sa.String(64),nullable=False),
        sa.Column("closeout_fingerprint",sa.String(64),nullable=False),sa.Column("signoff_role",sa.String(80),nullable=False,server_default="project_owner"),
        sa.Column("signoff_note",sa.Text(),nullable=False,server_default=""),sa.Column("evidence_reference",sa.Text(),nullable=False,server_default=""),
        sa.Column("signed_by",sa.String(36),nullable=False),sa.Column("signed_at",sa.DateTime(timezone=True),nullable=False),
        sa.UniqueConstraint("user_id","project_id","version",name="uq_closeout_signoff_version"))
    for col in ("user_id","project_id","snapshot_id"):
        op.create_index(f"ix_delivery_closeout_signoffs_{col}","delivery_closeout_signoffs",[col])
    op.create_table("project_closure_records",
        sa.Column("id",sa.String(36),primary_key=True),
        sa.Column("user_id",sa.String(36),sa.ForeignKey("users.id",ondelete="CASCADE"),nullable=False),
        sa.Column("project_id",sa.String(36),sa.ForeignKey("projects.id",ondelete="CASCADE"),nullable=False),
        sa.Column("signoff_id",sa.String(36),sa.ForeignKey("delivery_closeout_signoffs.id",ondelete="RESTRICT"),nullable=False,unique=True),
        sa.Column("snapshot_hash",sa.String(64),nullable=False),sa.Column("closeout_fingerprint",sa.String(64),nullable=False),
        sa.Column("confirmation_phrase",sa.String(40),nullable=False),sa.Column("closed_by",sa.String(36),nullable=False),
        sa.Column("closed_at",sa.DateTime(timezone=True),nullable=False),sa.Column("closure_note",sa.Text(),nullable=False,server_default=""))
    for col in ("user_id","project_id"):
        op.create_index(f"ix_project_closure_records_{col}","project_closure_records",[col])

def downgrade():
    for col in ("project_id","user_id"):
        op.drop_index(f"ix_project_closure_records_{col}",table_name="project_closure_records")
    op.drop_table("project_closure_records")
    for col in ("snapshot_id","project_id","user_id"):
        op.drop_index(f"ix_delivery_closeout_signoffs_{col}",table_name="delivery_closeout_signoffs")
    op.drop_table("delivery_closeout_signoffs")

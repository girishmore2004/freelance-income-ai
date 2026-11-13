"""Link revision snapshots to exact client feedback or approved scope records."""
from alembic import op
import sqlalchemy as sa

revision = "0036_revision_evidence_links"
down_revision = "0035_deliverable_revision_origin"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("deliverable_revisions", sa.Column("client_feedback_event_id", sa.String(length=36), nullable=True))
    op.add_column("deliverable_revisions", sa.Column("scope_change_request_id", sa.String(length=36), nullable=True))
    op.create_index("ix_deliverable_revisions_client_feedback_event_id", "deliverable_revisions", ["client_feedback_event_id"])
    op.create_index("ix_deliverable_revisions_scope_change_request_id", "deliverable_revisions", ["scope_change_request_id"])
    op.create_foreign_key("fk_revision_client_feedback_event", "deliverable_revisions", "deliverable_acceptance_events", ["client_feedback_event_id"], ["id"], ondelete="RESTRICT")
    op.create_foreign_key("fk_revision_scope_change_request", "deliverable_revisions", "scope_change_requests", ["scope_change_request_id"], ["id"], ondelete="RESTRICT")

def downgrade():
    op.drop_constraint("fk_revision_scope_change_request", "deliverable_revisions", type_="foreignkey")
    op.drop_constraint("fk_revision_client_feedback_event", "deliverable_revisions", type_="foreignkey")
    op.drop_index("ix_deliverable_revisions_scope_change_request_id", table_name="deliverable_revisions")
    op.drop_index("ix_deliverable_revisions_client_feedback_event_id", table_name="deliverable_revisions")
    op.drop_column("deliverable_revisions", "scope_change_request_id")
    op.drop_column("deliverable_revisions", "client_feedback_event_id")

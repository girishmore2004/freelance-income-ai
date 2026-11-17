"""Change orders on active contracts and two-way reviews (Phase 3).

Revision ID: 0055_change_orders_reviews
Revises: 0054_delivery_workspace

* ``contracts.agreed_version``: the version both parties accepted. Delivery
  follows these terms while a change order (a newer ``current_version``) waits
  for acceptance. Backfilled for active/completed contracts.
* ``contract_reviews``: one review per party per completed contract (rating
  1–5, comment). Reviews are revealed when both parties reviewed, or 14 days
  after completion, so neither side can retaliate.

Additive. Downgrade drops the table and the column.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0055_change_orders_reviews"
down_revision = "0054_delivery_workspace"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def upgrade():
    tables = _tables()
    if "contract_events" not in tables:
        raise RuntimeError("contract_events does not exist. Apply 0054 first.")
    now = sa.text("CURRENT_TIMESTAMP")

    if "agreed_version" not in {c["name"] for c in inspect(op.get_bind()).get_columns("contracts")}:
        op.add_column("contracts", sa.Column("agreed_version", sa.Integer(), nullable=True))
    op.execute("UPDATE contracts SET agreed_version = current_version WHERE agreed_version IS NULL AND status IN ('active', 'completed')")

    if "contract_reviews" not in tables:
        op.create_table(
            "contract_reviews",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("contract_id", sa.String(36), sa.ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False),
            sa.Column("reviewer_party", sa.String(20), nullable=False),
            sa.Column("reviewer_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("rating", sa.Integer(), nullable=False),
            sa.Column("comment", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.UniqueConstraint("contract_id", "reviewer_party", name="uq_contract_review_party"),
            sa.CheckConstraint("reviewer_party IN ('client', 'freelancer')", name="ck_contract_reviews_party"),
            sa.CheckConstraint("rating >= 1 AND rating <= 5", name="ck_contract_reviews_rating"),
        )


def downgrade():
    tables = _tables()
    if "contract_reviews" in tables:
        op.drop_table("contract_reviews")
    if "contracts" in tables and "agreed_version" in {c["name"] for c in inspect(op.get_bind()).get_columns("contracts")}:
        op.drop_column("contracts", "agreed_version")

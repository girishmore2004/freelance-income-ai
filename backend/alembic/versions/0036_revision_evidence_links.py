
"""Link revision snapshots to exact client feedback or approved scope records."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0036_revision_evidence_links"
down_revision = "0035_deliverable_revision_origin"
branch_labels = None
depends_on = None


TABLE = "deliverable_revisions"


def _inspector():
    return inspect(op.get_bind())


def _ensure_column(name):
    columns = {
        column["name"]
        for column in _inspector().get_columns(TABLE)
    }

    if name not in columns:
        op.add_column(
            TABLE,
            sa.Column(
                name,
                sa.String(length=36),
                nullable=True,
            ),
        )


def _ensure_index(name, column):
    indexes = {
        index["name"]
        for index in _inspector().get_indexes(TABLE)
    }

    if name not in indexes:
        op.create_index(name, TABLE, [column])


def _ensure_foreign_key(
    name,
    referred_table,
    local_column,
):
    foreign_keys = _inspector().get_foreign_keys(TABLE)

    exists = any(
        fk.get("constrained_columns") == [local_column]
        and fk.get("referred_table") == referred_table
        and fk.get("referred_columns") == ["id"]
        for fk in foreign_keys
    )

    if not exists:
        op.create_foreign_key(
            name,
            TABLE,
            referred_table,
            [local_column],
            ["id"],
            ondelete="RESTRICT",
        )


def upgrade():
    if TABLE not in _inspector().get_table_names():
        raise RuntimeError(f"Required table {TABLE!r} does not exist.")

    _ensure_column("client_feedback_event_id")
    _ensure_column("scope_change_request_id")

    _ensure_index(
        "ix_deliverable_revisions_client_feedback_event_id",
        "client_feedback_event_id",
    )

    _ensure_index(
        "ix_deliverable_revisions_scope_change_request_id",
        "scope_change_request_id",
    )

    _ensure_foreign_key(
        "fk_revision_client_feedback_event",
        "deliverable_acceptance_events",
        "client_feedback_event_id",
    )

    _ensure_foreign_key(
        "fk_revision_scope_change_request",
        "scope_change_requests",
        "scope_change_request_id",
    )


def downgrade():
    # These links are part of the immutable revision evidence trail.
    # Preserve them during automatic downgrades.
    pass

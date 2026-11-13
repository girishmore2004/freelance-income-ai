
from pathlib import Path
import importlib.util

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    create_engine,
    inspect,
)


MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "0017_business_workspace.py"
)


def load_migration():
    spec = importlib.util.spec_from_file_location(
        "migration_0017_business_workspace",
        MIGRATION_PATH,
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def create_baseline_schema(engine):
    metadata = MetaData()

    Table(
        "users",
        metadata,
        Column("id", String(36), primary_key=True),
    )

    Table(
        "business_goals",
        metadata,
        Column("id", String(36), primary_key=True),
        Column(
            "user_id",
            String(36),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        Column("monthly_income_target", Float, nullable=False),
        Column("weekly_hours_target", Float, nullable=False),
        Column("monthly_proposals_target", Integer, nullable=False),
        Column("monthly_outreach_target", Integer, nullable=False),
        Column("currency", String(8), nullable=False),
        Column("updated_at", DateTime(timezone=True), nullable=False),
    )

    Table(
        "business_workspace_events",
        metadata,
        Column("id", String(36), primary_key=True),
        Column(
            "user_id",
            String(36),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        Column("event_type", String(60), nullable=False),
        Column("entity_type", String(60), nullable=False),
        Column("entity_id", String(36), nullable=False),
        Column("detail", Text, nullable=False),
        Column("created_at", DateTime(timezone=True), nullable=False),
    )

    metadata.create_all(engine)


def run_migration(migration, connection):
    """
    Execute an Alembic migration using a real Operations context.

    Alembic's op proxy requires an active MigrationContext.
    Patching op.get_bind() alone is insufficient because operations
    such as create_table() also require the Operations implementation.
    """
    context = MigrationContext.configure(connection)

    with Operations.context(context):
        migration.upgrade()


def test_upgrade_does_not_recreate_existing_business_tables():
    migration = load_migration()
    engine = create_engine("sqlite://")

    create_baseline_schema(engine)

    with engine.begin() as connection:
        run_migration(migration, connection)

        inspector = inspect(connection)
        tables = set(inspector.get_table_names())

        assert "business_goals" in tables
        assert "business_workspace_events" in tables

        goals_indexes = {
            index["name"]
            for index in inspector.get_indexes("business_goals")
        }

        events_indexes = {
            index["name"]
            for index in inspector.get_indexes(
                "business_workspace_events"
            )
        }

        assert "ix_business_goals_user_id" in goals_indexes

        assert {
            "ix_business_workspace_events_user_id",
            "ix_business_workspace_events_event_type",
            "ix_business_workspace_events_created_at",
        }.issubset(events_indexes)


def test_upgrade_creates_missing_business_tables():
    migration = load_migration()
    engine = create_engine("sqlite://")

    metadata = MetaData()

    Table(
        "users",
        metadata,
        Column("id", String(36), primary_key=True),
    )

    metadata.create_all(engine)

    with engine.begin() as connection:
        run_migration(migration, connection)

        inspector = inspect(connection)
        tables = set(inspector.get_table_names())

        assert "business_goals" in tables
        assert "business_workspace_events" in tables

        goals_indexes = {
            index["name"]
            for index in inspector.get_indexes("business_goals")
        }

        events_indexes = {
            index["name"]
            for index in inspector.get_indexes(
                "business_workspace_events"
            )
        }

        assert goals_indexes >= {
            "ix_business_goals_user_id",
        }

        assert events_indexes >= {
            "ix_business_workspace_events_user_id",
            "ix_business_workspace_events_event_type",
            "ix_business_workspace_events_created_at",
        }

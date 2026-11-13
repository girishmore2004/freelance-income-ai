
"""Safe schema inspection helpers for Alembic migrations."""

from sqlalchemy import inspect
from alembic import op


def inspector():
    return inspect(op.get_bind())


def table_exists(table_name: str) -> bool:
    return table_name in inspector().get_table_names()


def column_names(table_name: str) -> set[str]:
    if not table_exists(table_name):
        raise RuntimeError(
            f"Required table {table_name!r} does not exist."
        )

    return {
        column["name"]
        for column in inspector().get_columns(table_name)
    }


def ensure_column(table_name: str, column) -> None:
    if column.name not in column_names(table_name):
        op.add_column(table_name, column)


def ensure_index(
    table_name: str,
    index_name: str,
    columns: list[str],
) -> None:
    existing = {
        index["name"]
        for index in inspector().get_indexes(table_name)
    }

    if index_name not in existing:
        op.create_index(
            index_name,
            table_name,
            columns,
        )


def validate_columns(
    table_name: str,
    expected_columns: set[str],
) -> None:
    actual = column_names(table_name)
    missing = expected_columns - actual

    if missing:
        raise RuntimeError(
            f"Schema mismatch in {table_name!r}. "
            f"Missing columns: {sorted(missing)}"
        )

from pathlib import Path
import ast
import sys

MIGRATIONS_DIR = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
)

MAX_REVISION_LENGTH = 32


def read_assignments(path: Path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    values = {}

    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue

        if len(node.targets) != 1:
            continue

        target = node.targets[0]

        if not isinstance(target, ast.Name):
            continue

        if target.id not in {"revision", "down_revision"}:
            continue

        try:
            values[target.id] = ast.literal_eval(node.value)
        except (ValueError, TypeError):
            raise ValueError(
                f"{path.name}: {target.id} must be a literal value"
            )

    return values


def main():
    errors = []
    revisions = {}
    files = sorted(MIGRATIONS_DIR.glob("*.py"))

    for path in files:
        if path.name == "__init__.py":
            continue

        try:
            values = read_assignments(path)
        except Exception as exc:
            errors.append(f"{path.name}: cannot parse: {exc}")
            continue

        revision = values.get("revision")

        if not isinstance(revision, str):
            errors.append(
                f"{path.name}: missing string revision identifier"
            )
            continue

        if len(revision) > MAX_REVISION_LENGTH:
            errors.append(
                f"{path.name}: revision length {len(revision)} "
                f"exceeds {MAX_REVISION_LENGTH}: {revision}"
            )

        if revision in revisions:
            errors.append(
                f"Duplicate revision {revision}: "
                f"{revisions[revision]} and {path.name}"
            )

        revisions[revision] = path.name

        down_revision = values.get("down_revision")

        parents = (
            down_revision
            if isinstance(down_revision, tuple)
            else (down_revision,)
        )

        for parent in parents:
            if parent is not None and not isinstance(parent, str):
                errors.append(
                    f"{path.name}: invalid down_revision {parent!r}"
                )

    for path in files:
        if path.name == "__init__.py":
            continue

        try:
            values = read_assignments(path)
        except Exception:
            continue

        down_revision = values.get("down_revision")

        parents = (
            down_revision
            if isinstance(down_revision, tuple)
            else (down_revision,)
        )

        for parent in parents:
            if parent is not None and parent not in revisions:
                errors.append(
                    f"{path.name}: unknown parent revision {parent!r}"
                )

    if errors:
        print("Migration validation FAILED:")
        for error in errors:
            print(f" - {error}")
        return 1

    print(
        f"Migration validation passed: "
        f"{len(revisions)} revisions, all IDs <= "
        f"{MAX_REVISION_LENGTH} characters."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

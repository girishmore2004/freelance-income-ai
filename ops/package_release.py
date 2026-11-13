#!/usr/bin/env python3
"""Create a deterministic, secret-safe source ZIP with SHA-256 manifests."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import zipfile

EXCLUDED_DIRS = {
    ".git", ".next", "node_modules", "__pycache__", ".pytest_cache",
    ".mypy_cache", ".ruff_cache", ".venv", "venv", "env", "dist", "build",
    "coverage", "playwright-report", "test-results", "backups",
}
EXCLUDED_NAMES = {".env", ".env.local", ".env.production", ".DS_Store"}
EXCLUDED_SUFFIXES = {".pyc", ".pyo", ".sqlite", ".sqlite3", ".db", ".dump", ".bak"}
MANIFEST_NAMES = {"FILE_MANIFEST.json", "MANIFEST.sha256", "SHA256SUMS.txt"}

def included(path: Path) -> bool:
    parts = set(path.parts)
    if parts & EXCLUDED_DIRS or path.name in EXCLUDED_NAMES:
        return False
    if (path.name.startswith(".env.") and path.name != ".env.example") or path.suffix.lower() in EXCLUDED_SUFFIXES:
        return False
    if path.name in MANIFEST_NAMES:
        return False
    if path.is_symlink() or not path.is_file():
        return False
    return True

def build(root: Path, output: Path) -> dict:
    root = root.resolve()
    output = output.resolve()
    version_file = root / "VERSION"
    if not version_file.is_file():
        raise SystemExit("VERSION file is missing.")
    version = version_file.read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise SystemExit("VERSION must use semantic version MAJOR.MINOR.PATCH.")
    if output == root or root in output.parents:
        raise SystemExit("Output ZIP must be outside the source directory.")
    files = sorted(path for path in root.rglob("*") if included(path))
    entries = []
    for path in files:
        rel = path.relative_to(root).as_posix()
        data = path.read_bytes()
        entries.append({"path": rel, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    manifest = {"version": version, "file_count": len(entries), "files": entries}
    manifest_bytes = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode()
    sha_lines = [f"{item['sha256']}  {item['path']}" for item in entries]
    sha_lines.append(f"{hashlib.sha256(manifest_bytes).hexdigest()}  FILE_MANIFEST.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        prefix = f"freelance-income-ai-{version}"
        for path in files:
            zf.write(path, f"{prefix}/{path.relative_to(root).as_posix()}")
        zf.writestr(f"{prefix}/FILE_MANIFEST.json", manifest_bytes)
        zf.writestr(f"{prefix}/MANIFEST.sha256", "\n".join(sha_lines) + "\n")
    with zipfile.ZipFile(output) as zf:
        bad = zf.testzip()
        if bad:
            raise SystemExit(f"ZIP CRC validation failed: {bad}")
        names = zf.namelist()
        if any(Path(n).name in EXCLUDED_NAMES or "/node_modules/" in n or "/.git/" in n for n in names):
            raise SystemExit("Forbidden file detected in release archive.")
        for item in entries:
            archived = f"{prefix}/{item['path']}"
            if hashlib.sha256(zf.read(archived)).hexdigest() != item["sha256"]:
                raise SystemExit(f"Archive checksum mismatch: {item['path']}")
    return {"version": version, "files": len(entries), "zip": str(output),
            "zip_bytes": output.stat().st_size, "crc": "PASS", "manifest": "PASS"}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    print(json.dumps(build(Path(args.root), Path(args.output)), indent=2))

if __name__ == "__main__":
    main()

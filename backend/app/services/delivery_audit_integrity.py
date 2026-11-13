"""Tamper-evident per-project hash chaining for delivery audit events.

This detects accidental or unauthorized edits/deletions within the stored chain;
it is not a digital signature and cannot protect against an attacker who can
rewrite the entire database and recompute every hash.
"""
from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from datetime import datetime, timezone


def _canonical_timestamp(value) -> str:
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat(timespec="microseconds")


def audit_event_payload(event, previous_hash: str) -> dict:
    return {
        "id": str(event.id),
        "user_id": str(event.user_id),
        "project_id": str(event.project_id),
        "deliverable_id": str(event.deliverable_id or ""),
        "event_type": str(event.event_type),
        "detail": str(event.detail or ""),
        "created_at": _canonical_timestamp(event.created_at),
        "previous_hash": str(previous_hash or ""),
        "chain_version": 1,
    }


def calculate_audit_event_hash(event, previous_hash: str) -> str:
    encoded = json.dumps(audit_event_payload(event, previous_hash), sort_keys=True,
                         separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def verify_delivery_audit_chains(events, project_heads=None) -> dict:
    grouped = defaultdict(list)
    for event in events:
        grouped[(event.user_id, event.project_id)].append(event)
    projects = []
    project_heads = project_heads or {}
    all_keys = set(grouped) | set(project_heads)
    for (user_id, project_id) in sorted(all_keys):
        rows = grouped.get((user_id, project_id), [])
        def order_key(event):
            stamp = event.created_at
            if getattr(stamp, "tzinfo", None) is None:
                stamp = stamp.replace(tzinfo=timezone.utc)
            return (stamp, str(event.id))
        rows.sort(key=order_key)
        previous = ""
        broken = []
        for index, event in enumerate(rows):
            stored_previous = str(getattr(event, "previous_hash", "") or "")
            expected = calculate_audit_event_hash(event, previous)
            if stored_previous != previous or str(getattr(event, "event_hash", "") or "") != expected:
                broken.append({"event_id": event.id, "sequence": index + 1,
                               "previous_hash_matches": stored_previous == previous,
                               "event_hash_matches": str(getattr(event, "event_hash", "") or "") == expected})
            previous = str(getattr(event, "event_hash", "") or "")
        has_project_anchor = (user_id, project_id) in project_heads
        stored_head = str(project_heads.get((user_id, project_id), "") or "")
        head_matches = (not has_project_anchor) or stored_head == previous
        if not head_matches:
            broken.append({"event_id": None, "sequence": len(rows) + 1,
                           "previous_hash_matches": None, "event_hash_matches": False,
                           "stored_project_head_matches": False})
        projects.append({"project_id": project_id, "event_count": len(rows),
                         "chain_status": "valid" if not broken else "integrity_issue",
                         "first_event_at": str(rows[0].created_at) if rows else None,
                         "last_event_at": str(rows[-1].created_at) if rows else None,
                         "head_hash": previous or None, "stored_project_head_hash": stored_head or None,
                         "stored_project_head_matches": head_matches, "issues": broken})
    return {"summary": {"projects_checked": len(projects),
                        "valid_projects": sum(p["chain_status"] == "valid" for p in projects),
                        "projects_with_integrity_issues": sum(p["chain_status"] != "valid" for p in projects),
                        "events_checked": sum(p["event_count"] for p in projects)},
            "projects": projects,
            "limitations": ["Hash chaining detects changes within the stored chain but is not a digital signature.",
                            "A database administrator able to rewrite all rows and hashes can forge a new chain.",
                            "The chain records application audit events; it does not independently prove that a client sent or approved a communication."]}

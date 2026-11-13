"""Non-destructive retention and redaction previews for immutable handover snapshots."""
from copy import deepcopy
from datetime import datetime, timezone, timedelta
from .handover_snapshots import snapshot_hash


def build_redaction_preview(snapshot, options=None):
    options = options or {}
    selected = {
        "client_name": bool(options.get("redact_client_name", True)),
        "invoice_numbers": bool(options.get("redact_invoice_numbers", True)),
        "evidence_references": bool(options.get("redact_evidence_references", True)),
        "free_text": bool(options.get("redact_free_text", False)),
    }
    result = deepcopy(snapshot)
    def walk(value):
        if isinstance(value, dict):
            for key, child in list(value.items()):
                if selected["client_name"] and key == "client_name" and child:
                    value[key] = "[REDACTED]"
                elif selected["invoice_numbers"] and key == "invoice_number" and child:
                    value[key] = "[REDACTED]"
                elif selected["evidence_references"] and key in {
                    "evidence_reference", "origin_evidence_reference", "content_reference", "reference"
                } and child:
                    value[key] = "[REDACTED]"
                elif selected["free_text"] and key in {
                    "description", "note", "origin_note", "resolution_note", "corrective_action", "closure_note"
                } and child:
                    value[key] = "[REDACTED]"
                else:
                    walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)
    walk(result)
    return {"redaction_options": selected, "redacted_preview_hash": snapshot_hash(result),
            "redacted_preview": result,
            "disclosure": "Preview only. The immutable source snapshot is unchanged; no data is deleted or externally shared."}


def build_retention_preview(snapshot_row, retention_days=365, now=None):
    if not 30 <= int(retention_days) <= 3650:
        raise ValueError("retention_days must be between 30 and 3650")
    now = now or datetime.now(timezone.utc)
    created = snapshot_row.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    eligible = created + timedelta(days=int(retention_days))
    return {"snapshot_id": snapshot_row.id, "version": snapshot_row.version,
        "status": snapshot_row.status, "created_at": created.isoformat(),
        "retention_days_preview": int(retention_days), "review_eligible_at": eligible.isoformat(),
        "days_until_review": max(0, (eligible.date() - now.date()).days),
        "review_eligible": now >= eligible, "action": "review_only_no_deletion",
        "disclosure": "This is a retention planning preview only. No snapshot is deleted, archived, or modified."}

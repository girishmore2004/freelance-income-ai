"""Deterministic transition and evidence rules for delivery issue management."""

SEVERITIES = {"low", "medium", "high", "critical"}
TRANSITIONS = {
    "open": {"open", "triaged", "in_progress"},
    "triaged": {"triaged", "open", "in_progress"},
    "in_progress": {"in_progress", "triaged", "resolved"},
    "resolved": {"resolved", "in_progress", "closed"},
    "closed": set(),
}


def validate_issue_update(current_status: str, next_status: str, severity: str,
                          corrective_action: str, resolution_note: str,
                          resolution_evidence_reference: str) -> None:
    if severity not in SEVERITIES:
        raise ValueError("Severity must be low, medium, high or critical")
    if next_status not in TRANSITIONS.get(current_status, set()):
        raise ValueError(f"Invalid issue status transition: {current_status} → {next_status}")
    if next_status in {"in_progress", "resolved", "closed"} and len(corrective_action.strip()) < 5:
        raise ValueError("Record a corrective action before starting or resolving the issue")
    if next_status in {"resolved", "closed"} and (
        len(resolution_note.strip()) < 5 or len(resolution_evidence_reference.strip()) < 5
    ):
        raise ValueError("Resolution requires a note and evidence reference (at least 5 characters each)")
    if next_status == "closed" and current_status != "resolved":
        raise ValueError("Only resolved issues can be closed")

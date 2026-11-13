"""Integrity helpers for human-reviewed client contract records."""
import hashlib


def contract_content_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def can_transition_contract(current: str, target: str) -> bool:
    allowed = {
        "draft": {"sent", "archived"},
        "sent": {"accepted", "rejected", "expired", "archived"},
    }
    return target in allowed.get(current, set())


def verify_revision_chain(revisions) -> bool:
    """Verify ordered immutable snapshots link to the immediately prior content hash."""
    ordered = list(revisions)
    if not ordered:
        return True
    previous_hash = ""
    previous_version = None
    for item in ordered:
        version = item.version if hasattr(item, "version") else item["version"]
        digest = item.content_hash if hasattr(item, "content_hash") else item["content_hash"]
        parent = item.previous_hash if hasattr(item, "previous_hash") else item["previous_hash"]
        content = item.content if hasattr(item, "content") else item["content"]
        if digest != contract_content_hash(content):
            return False
        if previous_version is not None and version != previous_version + 1:
            return False
        if parent != previous_hash:
            return False
        previous_hash = digest
        previous_version = version
    return True

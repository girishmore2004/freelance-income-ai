"""Pure policy checks for proposal approval integrity."""
import hmac


def is_current_approval(decision, approved_hash, current_hash):
    """Only an approved decision bound to the exact current content is valid."""
    if decision != "approved" or not approved_hash or not current_hash:
        return False
    return hmac.compare_digest(str(approved_hash), str(current_hash))


def can_decide_approval(current_decision, approved_hash, current_hash):
    if current_decision != "pending":
        return False, "Approval already decided."
    if not approved_hash or not current_hash or not hmac.compare_digest(
        str(approved_hash), str(current_hash)
    ):
        return False, "Proposal changed after approval request; request a new approval."
    return True, ""

import re

RISK_RULES = [
    {
        "id": "upfront_payment",
        "patterns": [r"registration fee", r"pay\s+(?:a\s+)?deposit", r"upfront fee", r"security deposit", r"pay to get work"],
        "severity": "critical",
        "points": 35,
        "title": "Payment requested before work",
        "explanation": "The supplied text mentions a fee, deposit or payment before work begins. Verify independently and do not pay merely to access a job.",
    },
    {
        "id": "off_platform_payment",
        "patterns": [r"outside the platform", r"off[- ]platform", r"pay by crypto", r"gift card", r"wire transfer", r"send money to"],
        "severity": "high",
        "points": 25,
        "title": "Potential off-platform payment request",
        "explanation": "The supplied text mentions payment methods or arrangements that may bypass marketplace protections. Check the platform's terms before proceeding.",
    },
    {
        "id": "unpaid_test",
        "patterns": [r"unpaid test", r"free sample", r"work for free", r"test task without pay", r"spec work"],
        "severity": "high",
        "points": 20,
        "title": "Unpaid work request",
        "explanation": "The supplied text appears to request unpaid sample work. Clarify the scope and payment before doing substantive work.",
    },
    {
        "id": "credential_request",
        "patterns": [r"share your password", r"send login credentials", r"otp", r"one[- ]time password", r"remote access to your bank"],
        "severity": "critical",
        "points": 35,
        "title": "Sensitive credential request",
        "explanation": "The supplied text appears to request credentials, OTPs or sensitive access. Never share passwords, OTPs or banking credentials.",
    },
    {
        "id": "unrealistic_claim",
        "patterns": [r"guaranteed income", r"earn \$?\d+[,.]?\d* daily", r"no experience.*high pay", r"instant payment.*no interview"],
        "severity": "medium",
        "points": 10,
        "title": "Unusually strong earning promise",
        "explanation": "The wording contains a strong earning promise. Verify the client, deliverables and payment terms rather than relying on the claim.",
    },
]

def _signals(text):
    found = []
    text = (text or "").lower()
    for rule in RISK_RULES:
        if any(re.search(pattern, text, re.IGNORECASE) for pattern in rule["patterns"]):
            found.append({
                "id": rule["id"],
                "severity": rule["severity"],
                "points": rule["points"],
                "title": rule["title"],
                "explanation": rule["explanation"],
            })
    return found

def assess_client_risk(opportunity, evidence):
    listing_text = " ".join([
        opportunity.get("title", ""),
        opportunity.get("description", ""),
    ])
    listing_signals = _signals(listing_text)

    # Keep evidence provenance attached to every finding. A signal is a prompt
    # for human review, not a factual conclusion about the client.
    merged = {}
    for signal in listing_signals:
        item = dict(signal)
        item["sources"] = [{
            "source_type": "opportunity_listing",
            "source_url": opportunity.get("source_url", ""),
            "evidence_id": None,
        }]
        merged[item["id"]] = item

    evidence_sources = []
    for evidence_item in evidence:
        evidence_sources.append({
            "evidence_id": evidence_item.get("id"),
            "evidence_type": evidence_item.get("evidence_type", "other"),
            "claim": evidence_item.get("claim", ""),
            "source_url": evidence_item.get("evidence_url", ""),
            "confidence": evidence_item.get("confidence", "unverified"),
        })
        for signal in _signals(evidence_item.get("claim", "")):
            if signal["id"] not in merged:
                item = dict(signal)
                item["sources"] = []
                merged[item["id"]] = item
            merged[item["id"]]["sources"].append({
                "source_type": evidence_item.get("evidence_type", "other"),
                "source_url": evidence_item.get("evidence_url", ""),
                "evidence_id": evidence_item.get("id"),
                "confidence": evidence_item.get("confidence", "unverified"),
            })

    signals = list(merged.values())
    score = min(100, sum(item["points"] for item in signals))

    source_count = sum(1 for item in evidence if item.get("evidence_url"))
    evidence_count = len(evidence)
    has_listing = bool(opportunity.get("source_url"))
    verified_fields = sum([
        opportunity.get("client_payment_verified") is True,
        opportunity.get("client_rating") is not None,
        opportunity.get("client_reviews") is not None,
    ])
    coverage = min(100, (20 if has_listing else 0) + min(40, source_count * 20) +
                   min(40, evidence_count * 10) + min(20, verified_fields * 7))

    has_critical_signal = any(item["severity"] == "critical" for item in signals)
    if not signals and evidence_count == 0 and verified_fields == 0:
        level = "insufficient_data"
    elif has_critical_signal or score >= 50:
        level = "high"
    elif score >= 25:
        level = "elevated"
    elif score > 0:
        level = "moderate"
    elif coverage >= 60:
        level = "low"
    else:
        level = "insufficient_data"

    questions = []
    text = (opportunity.get("description") or "").lower()
    if not any(word in text for word in ("deliverable", "acceptance criteria", "milestone")):
        questions.append("Can you define the exact deliverables and acceptance criteria?")
    if not any(word in text for word in ("payment", "invoice", "escrow", "milestone")):
        questions.append("What are the payment terms, schedule and payment protection?")
    if not opportunity.get("deadline"):
        questions.append("What is the target deadline and is the timeline flexible?")
    if not any(item.get("evidence_type") in {"contract", "platform_profile", "client_history"} for item in evidence):
        questions.append("Can you share the official platform client profile or contract details?")
    if signals:
        questions.append("Can you clarify the flagged request in writing before proceeding?")

    return {
        "risk_score": score,
        "risk_level": level,
        "evidence_coverage": coverage,
        "evidence_count": evidence_count,
        "linked_source_count": source_count,
        "evidence_sources": evidence_sources,
        "signals": signals,
        "questions_to_ask": questions,
        "limitations": [
            "This is a screening aid, not a background check or a finding of fraud.",
            "Signals are keyword-based and may produce false positives or miss risks.",
            "Evidence confidence labels are supplied by the user and are not independently verified.",
            "A low score does not guarantee that a client or project is safe.",
        ],
    }

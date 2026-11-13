"""Service-category performance and milestone timing from recorded freelance data."""
from collections import defaultdict
from datetime import date, datetime, timezone
from statistics import median
import json
import re


CATEGORY_RULES = [
    ("ai_document_automation", ("invoice automation", "document automation", "pdf extraction", "ocr", "document processing", "data extraction")),
    ("ai_rag_copilot", ("rag", "retrieval augmented", "knowledge base", "ai copilot", "chatbot", "llm", "generative ai")),
    ("saas_mvp", ("saas", "mvp", "micro saas", "product prototype", "web application")),
    ("web_development", ("website", "web development", "frontend", "backend", "react", "next.js", "mern")),
    ("data_analytics", ("data analytics", "dashboard", "power bi", "data engineering", "etl", "databricks", "snowflake")),
]


def _dt(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    except (TypeError, ValueError):
        try:
            d = date.fromisoformat(str(value)[:10])
            return datetime.combine(d, datetime.min.time(), tzinfo=timezone.utc)
        except (TypeError, ValueError):
            return None


def _amount(value):
    try:
        result = float(value or 0)
        return result if result >= 0 else 0.0
    except (TypeError, ValueError):
        return 0.0


def _category(opportunity):
    industry = str(getattr(opportunity, "industry", "") or "").strip()
    if industry:
        return "industry:" + re.sub(r"[^a-z0-9]+", "_", industry.lower()).strip("_"), "explicit_industry"
    raw = " ".join(str(getattr(opportunity, field, "") or "") for field in
                   ("title", "description", "required_skills")).lower()
    try:
        skills = json.loads(getattr(opportunity, "required_skills", "[]") or "[]")
        if isinstance(skills, list):
            raw += " " + " ".join(map(str, skills)).lower()
    except (TypeError, ValueError):
        pass
    for category, terms in CATEGORY_RULES:
        if any(term in raw for term in terms):
            return category, "keyword_inferred"
    return "other_or_unclassified", "unclassified"


def _days(start, end):
    a, b = _dt(start), _dt(end)
    if not a or not b or b < a:
        return None
    return round((b - a).total_seconds() / 86400, 2)


def build_service_intelligence(opportunities, proposals, applications, feedback,
                               projects=(), invoices=(), payment_events=(),
                               cost_entries=(), time_entries=()):
    """Aggregate category outcomes and economics without mixing currencies.

    Category selection uses explicit opportunity.industry first, otherwise a transparent
    keyword taxonomy. Monetary values are attributed only through explicit project links.
    """
    opps = {o.id: o for o in opportunities}
    projects_by_id = {p.id: p for p in projects}
    invoices_by_id = {i.id: i for i in invoices}
    proposal_by_opp = defaultdict(list)
    app_by_opp = defaultdict(list)
    feedback_by_opp = defaultdict(list)
    project_by_opp = defaultdict(list)
    for row in proposals:
        if row.opportunity_id in opps:
            proposal_by_opp[row.opportunity_id].append(row)
    for row in applications:
        if row.opportunity_id in opps:
            app_by_opp[row.opportunity_id].append(row)
    for row in feedback:
        if row.opportunity_id in opps:
            feedback_by_opp[row.opportunity_id].append(row)
    for row in projects:
        if row.origin_opportunity_id in opps:
            project_by_opp[row.origin_opportunity_id].append(row)

    buckets = defaultdict(lambda: {
        "opps": [], "proposal_days": [], "submission_days": [], "win_days": [],
        "project_days": [], "payment_days": [], "decided": 0, "wins": 0,
        "projects": set(), "cash": defaultdict(float), "direct_cost": defaultdict(float),
        "labor_cost": defaultdict(float), "labor_minutes": defaultdict(int),
        "classification_methods": defaultdict(int),
    })
    category_for_opp = {}
    for opp in opportunities:
        category, method = _category(opp)
        category_for_opp[opp.id] = category
        b = buckets[category]
        b["opps"].append(opp)
        b["classification_methods"][method] += 1
        created = getattr(opp, "created_at", None)
        proposals_for = sorted(proposal_by_opp[opp.id], key=lambda x: _dt(getattr(x, "created_at", None)) or datetime.max.replace(tzinfo=timezone.utc))
        if proposals_for:
            d = _days(created, getattr(proposals_for[0], "created_at", None))
            if d is not None:
                b["proposal_days"].append(d)
        submitted = [x for x in app_by_opp[opp.id]
                     if str(getattr(x, "status", "")).lower() in
                     ("submitted", "viewed", "interviewing", "hired", "lost", "rejected")
                     and getattr(x, "submitted_at", None)]
        if submitted:
            first = min(submitted, key=lambda x: _dt(x.submitted_at) or datetime.max.replace(tzinfo=timezone.utc))
            d = _days(created, first.submitted_at)
            if d is not None:
                b["submission_days"].append(d)
        fb = sorted(feedback_by_opp[opp.id],
                    key=lambda x: _dt(getattr(x, "created_at", None)) or datetime.min.replace(tzinfo=timezone.utc))
        latest = fb[-1] if fb else None
        outcome = str(getattr(latest, "outcome", "") or "").lower() if latest else ""
        if outcome in ("won", "lost", "rejected"):
            b["decided"] += 1
            if outcome == "won":
                b["wins"] += 1
                d = _days(created, getattr(latest, "created_at", None))
                if d is not None:
                    b["win_days"].append(d)
        linked_projects = project_by_opp[opp.id]
        for project in linked_projects:
            b["projects"].add(project.id)
            d = _days(created, getattr(project, "created_at", None))
            if d is not None:
                b["project_days"].append(d)

    first_receipt_by_opp = {}
    for event in payment_events:
        invoice = invoices_by_id.get(getattr(event, "invoice_id", None))
        project = projects_by_id.get(getattr(invoice, "project_id", None)) if invoice else None
        oid = getattr(project, "origin_opportunity_id", None) if project else None
        if oid not in category_for_opp:
            continue
        event_type = str(getattr(event, "event_type", "") or "").lower()
        if event_type not in ("receipt", "refund"):
            continue
        opp = opps[oid]
        d = _days(getattr(opp, "created_at", None), getattr(event, "occurred_at", None))
        if d is not None and event_type == "receipt":
            previous = first_receipt_by_opp.get(oid)
            if previous is None or d < previous:
                first_receipt_by_opp[oid] = d
        currency = getattr(event, "currency", None) or getattr(invoice, "currency", None) or "INR"
        sign = -1 if event_type == "refund" else 1
        buckets[category_for_opp[oid]]["cash"][currency] += sign * _amount(getattr(event, "amount", 0))

    for oid, days_to_receipt in first_receipt_by_opp.items():
        buckets[category_for_opp[oid]]["payment_days"].append(days_to_receipt)

    for cost in cost_entries:
        project = projects_by_id.get(getattr(cost, "project_id", None))
        oid = getattr(project, "origin_opportunity_id", None) if project else None
        if oid not in category_for_opp:
            continue
        currency = getattr(cost, "currency", None) or "INR"
        buckets[category_for_opp[oid]]["direct_cost"][currency] += _amount(getattr(cost, "amount", 0))

    for entry in time_entries:
        project = projects_by_id.get(getattr(entry, "project_id", None))
        oid = getattr(project, "origin_opportunity_id", None) if project else None
        if oid not in category_for_opp or not getattr(entry, "billable", False):
            continue
        minutes = max(0, int(getattr(entry, "duration_minutes", 0) or 0))
        currency = getattr(entry, "currency", None) or "INR"
        rate = _amount(getattr(entry, "hourly_rate", 0))
        bucket = buckets[category_for_opp[oid]]
        bucket["labor_minutes"][currency] += minutes
        if rate > 0:
            bucket["labor_cost"][currency] += minutes / 60 * rate

    def med(values):
        return round(median(values), 2) if values else None

    rows = []
    for category, b in buckets.items():
        total = len(b["opps"])
        currencies = sorted(set(b["cash"]) | set(b["direct_cost"]) | set(b["labor_cost"]))
        economics = {}
        for currency in currencies:
            cash = round(b["cash"].get(currency, 0), 2)
            direct = round(b["direct_cost"].get(currency, 0), 2)
            labor = round(b["labor_cost"].get(currency, 0), 2)
            has_cost = direct > 0 or labor > 0
            economics[currency] = {
                "net_recorded_cash": cash,
                "recorded_direct_project_cost": direct,
                "estimated_billable_labor_cost": labor,
                "estimated_contribution_after_recorded_costs": round(cash-direct-labor, 2) if has_cost else None,
                "margin_status": "partial_recorded_cost_estimate" if has_cost else "insufficient_linked_cost_data",
                "billable_minutes_recorded": b["labor_minutes"].get(currency, 0),
            }
        rows.append({
            "service_category": category, "opportunities": total,
            "classification_methods": dict(b["classification_methods"]),
            "with_proposal": sum(bool(proposal_by_opp[o.id]) for o in b["opps"]),
            "decided_outcomes": b["decided"], "wins": b["wins"],
            "win_rate_percent": round(b["wins"] * 100 / b["decided"], 1) if b["decided"] else None,
            "projects_created": len(b["projects"]),
            "median_days_to_proposal": med(b["proposal_days"]),
            "median_days_to_submission": med(b["submission_days"]),
            "median_days_to_win": med(b["win_days"]),
            "median_days_to_project": med(b["project_days"]),
            "median_days_to_first_receipt": med(b["payment_days"]),
            "economics_by_currency": economics,
            "data_quality": "industry is explicit when supplied; otherwise category is inferred from title/description/skills; financial values require explicit project links",
        })
    return {
        "categories": sorted(rows, key=lambda x: (-x["opportunities"], x["service_category"])),
        "method": "Category is explicit opportunity.industry when present; otherwise a deterministic keyword taxonomy. Time-to-milestone uses recorded timestamps. Cash uses receipt/refund events linked invoice → project → originating opportunity. Direct costs and billable labor use explicit project links.",
        "limitations": [
            "Keyword-inferred categories can be wrong; inspect classification_methods and correct the opportunity industry when needed.",
            "Only the latest recorded feedback outcome per opportunity is used.",
            "Payment events are manually recorded evidence, not a connected bank or payment processor feed.",
            "Contribution is partial: it excludes taxes, platform fees, overhead and any unrecorded costs; it is withheld when no linked costs are recorded.",
            "Currencies are reported separately and are never converted or combined.",
            "Missing timestamps and unlinked records are excluded; medians are not promises of future delivery speed.",
        ],
    }

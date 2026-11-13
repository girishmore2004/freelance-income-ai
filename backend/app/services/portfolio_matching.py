"""Explainable, user-scoped opportunity fit against profile skills and portfolio evidence."""
import json
import re
from collections import Counter

STOP = {"and", "the", "for", "with", "from", "that", "this", "will", "you", "your", "are", "our", "can", "have", "has", "job", "work", "need", "build", "create", "project", "using", "use", "looking", "help", "experience", "required", "skills"}
ALIASES = {
    "react.js": "react", "reactjs": "react", "next.js": "nextjs", "next js": "nextjs",
    "node.js": "nodejs", "node js": "nodejs", "express.js": "express", "mongodb": "mongodb",
    "postgresql": "postgres", "postgres": "postgres", "llms": "llm", "large language models": "llm",
    "retrieval augmented generation": "rag", "generative ai": "genai", "artificial intelligence": "ai",
    "machine learning": "ml", "power bi": "powerbi", "amazon web services": "aws",
}


def _json_list(value):
    if isinstance(value, list):
        return [str(x).strip() for x in value if str(x).strip()]
    try:
        parsed = json.loads(value or "[]")
        return [str(x).strip() for x in parsed if str(x).strip()] if isinstance(parsed, list) else []
    except (TypeError, ValueError):
        return [x.strip() for x in str(value or "").split(",") if x.strip()]


def _norm(value):
    text = str(value or "").lower().strip()
    for source, target in sorted(ALIASES.items(), key=lambda x: len(x[0]), reverse=True):
        text = text.replace(source, target)
    return re.sub(r"[^a-z0-9+#]+", " ", text).strip()


def _terms(value):
    return {x for x in _norm(value).split() if len(x) > 1 and x not in STOP}


def _category(text):
    t = _norm(text)
    rules = {
        "ai_document_automation": ("ocr", "invoice", "document", "pdf", "extraction"),
        "ai_rag_copilot": ("rag", "copilot", "chatbot", "llm", "knowledge base", "genai"),
        "saas_mvp": ("saas", "mvp", "product prototype"),
        "web_development": ("website", "frontend", "backend", "react", "nextjs", "mern"),
        "data_analytics": ("analytics", "dashboard", "powerbi", "etl", "databricks", "snowflake"),
    }
    for category, terms in rules.items():
        if any(_norm(term) in t for term in terms):
            return category
    return "other_or_unclassified"


def _chunk_text(chunk):
    return str(getattr(chunk, "content", "") or "")


def match_opportunity_to_portfolio(opportunity, profile=None, chunks=None, documents=None):
    """Return transparent fit and quality scores; missing evidence is never treated as a mismatch."""
    profile = profile or object()
    chunks = list(chunks or [])
    docs = {str(getattr(d, "id", "")): getattr(d, "filename", "Portfolio evidence") for d in (documents or [])}
    required = _json_list(getattr(opportunity, "required_skills", "[]"))
    profile_skills = _json_list(getattr(profile, "skills", "[]"))
    profile_services = _json_list(getattr(profile, "services", "[]"))
    profile_text = " ".join([getattr(profile, "headline", "") or "", getattr(profile, "bio", "") or ""])
    profile_terms = _terms(" ".join(profile_skills) + " " + profile_text)
    matched = [s for s in required if _terms(s) and _terms(s).issubset(profile_terms)]
    missing = [s for s in required if s not in matched]
    skill_known = bool(required and (profile_skills or profile_services or profile_text.strip()))
    skill_score = round(100 * len(matched) / len(required), 1) if skill_known else None

    evidence = []
    chunk_terms = []
    for chunk in chunks:
        terms = _terms(_chunk_text(chunk))
        chunk_terms.append((chunk, terms))
    evidence_matched = []
    for skill in required:
        st = _terms(skill)
        if st and any(st.issubset(terms) for _, terms in chunk_terms):
            evidence_matched.append(skill)
    evidence_score = round(100 * len(evidence_matched) / len(required), 1) if required and chunks else None
    ranked = []
    query_terms = _terms(" ".join([getattr(opportunity, "title", "") or "", getattr(opportunity, "description", "") or ""] + required))
    for chunk, terms in chunk_terms:
        overlap = len(query_terms & terms)
        if overlap:
            ranked.append((overlap / max(1, len(query_terms)), chunk))
    ranked.sort(key=lambda x: (-x[0], getattr(x[1], "chunk_index", 0), str(getattr(x[1], "id", ""))))
    for relevance, chunk in ranked[:3]:
        evidence.append({"document": docs.get(str(getattr(chunk, "document_id", "")), "Portfolio evidence"),
                         "chunk_id": getattr(chunk, "id", None), "relevance": round(relevance, 3),
                         "excerpt": _chunk_text(chunk)[:320]})

    opportunity_text = " ".join([getattr(opportunity, "title", "") or "", getattr(opportunity, "description", "") or ""] + required)
    opp_category = _category(opportunity_text)
    service_category = _category(" ".join(profile_services + [getattr(profile, "headline", "") or ""])) if profile_services or getattr(profile, "headline", "") else "other_or_unclassified"
    service_score = (100.0 if opp_category == service_category and opp_category != "other_or_unclassified" else
                     50.0 if "other_or_unclassified" in (opp_category, service_category) else 0.0)
    service_known = bool(profile_services or getattr(profile, "headline", "")) and opp_category != "other_or_unclassified"

    components = []
    if skill_score is not None:
        components.append(("skill_fit", skill_score, 0.50))
    if evidence_score is not None:
        components.append(("portfolio_evidence", evidence_score, 0.35))
    if service_known:
        components.append(("service_alignment", service_score, 0.15))
    total_weight = sum(x[2] for x in components)
    overall = round(sum(score * weight for _, score, weight in components) / total_weight, 1) if total_weight else None

    description = str(getattr(opportunity, "description", "") or "").strip()
    budget_known = getattr(opportunity, "budget_min", None) is not None or getattr(opportunity, "budget_max", None) is not None
    client_known = str(getattr(opportunity, "client_name", "") or "").strip().lower() not in {"", "unknown", "none"}
    deadline_known = bool(str(getattr(opportunity, "deadline", "") or "").strip())
    quality_components = {
        "scope_clarity": 100 if len(description) >= 500 and len(required) >= 2 else 70 if len(description) >= 180 else 35 if description else None,
        "budget_transparency": 100 if budget_known else None,
        "client_information": 100 if client_known else None,
        "deadline_information": 100 if deadline_known else None,
    }
    known_quality = [v for v in quality_components.values() if v is not None]
    quality = round(sum(known_quality) / len(known_quality), 1) if known_quality else None
    confidence = "high" if len(components) >= 2 and len(required) >= 2 and chunks else "medium" if components else "low"
    reasons = []
    if matched:
        reasons.append(f"Profile explicitly covers {len(matched)} of {len(required)} listed required skills")
    if evidence_matched:
        reasons.append(f"Portfolio text contains evidence for {len(evidence_matched)} required skills")
    if missing:
        reasons.append("Potential skill/evidence gaps: " + ", ".join(missing[:8]))
    if not required:
        reasons.append("The listing has no structured required-skills list; skill fit cannot be scored reliably")
    if not chunks:
        reasons.append("No indexed portfolio chunks were available; portfolio evidence score is withheld")
    if overall is None:
        reasons.append("Insufficient profile or portfolio data for a defensible fit score")
    return {
        "opportunity_id": getattr(opportunity, "id", None), "title": getattr(opportunity, "title", ""),
        "source": getattr(opportunity, "source", ""), "fit_score": overall,
        "fit_confidence": confidence, "fit_components": {k: v for k, v, _ in components},
        "required_skills": required, "matched_profile_skills": matched,
        "portfolio_supported_skills": evidence_matched, "potential_gaps": missing,
        "service_category": opp_category, "portfolio_evidence": evidence,
        "opportunity_quality_score": quality, "quality_components": quality_components,
        "quality_data_coverage": round(100 * len(known_quality) / 4, 1),
        "reasons": reasons,
    }


def build_opportunity_fit(opportunities, profile=None, chunks=None, documents=None):
    rows = [match_opportunity_to_portfolio(o, profile, chunks, documents) for o in opportunities]
    rows.sort(key=lambda x: (x["fit_score"] is not None, x["fit_score"] or -1,
                             x["opportunity_quality_score"] is not None, x["opportunity_quality_score"] or -1), reverse=True)
    scored = [x for x in rows if x["fit_score"] is not None]
    return {"opportunities": rows, "summary": {"total": len(rows), "scored": len(scored),
            "high_fit": sum(1 for x in scored if x["fit_score"] >= 75),
            "average_fit_score": round(sum(x["fit_score"] for x in scored) / len(scored), 1) if scored else None},
            "method": "Deterministic profile-skill and portfolio-text matching with missing-data-aware weighted scoring.",
            "limitations": ["Portfolio evidence is lexical and does not verify project ownership or delivery quality.",
                            "Profile skill statements are user-provided and are not independently certified.",
                            "Opportunity quality measures listing completeness, not client honesty or probability of payment.",
                            "Scores are advisory; inspect source evidence and client-risk assessment before applying."]}

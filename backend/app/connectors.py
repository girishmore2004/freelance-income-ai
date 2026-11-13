import hashlib, re, socket, ipaddress, httpx, json
from urllib.parse import urlparse
from .core import settings
class ConnectorError(ValueError): pass
def validate_feed_url(url: str):
    p=urlparse(url)
    if p.scheme != "https" or not p.hostname: raise ConnectorError("RSS feeds must use HTTPS")
    allowed=[x.strip().lower() for x in settings.rss_allowed_domains.split(",") if x.strip()]
    if allowed and not any(p.hostname == d or p.hostname.endswith("."+d) for d in allowed): raise ConnectorError("Feed domain is not allowlisted")
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(p.hostname, p.port or 443, type=socket.SOCK_STREAM)}
        if not addresses or any(not ipaddress.ip_address(addr).is_global for addr in addresses):
            raise ConnectorError("Feed host resolves to a non-public IP address")
    except socket.gaierror as exc:
        raise ConnectorError("Feed host could not be resolved") from exc
    return p.hostname
def parse_rss(url: str):
    import feedparser
    validate_feed_url(url)
    try:
        response = httpx.get(url, timeout=12, follow_redirects=False, headers={"User-Agent": "FreelanceIncomeAI/0.1 RSS importer"})
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise ConnectorError("RSS feed could not be fetched; redirects are not followed") from exc
    feed=feedparser.parse(response.content)
    if feed.bozo and not feed.entries: raise ConnectorError("Could not parse RSS feed")
    out=[]
    for item in feed.entries[:settings.max_rss_items_per_feed]:
        link=item.get("link", "")
        title=item.get("title", "Untitled opportunity")
        desc=item.get("summary", item.get("description", "No description supplied"))
        ext=item.get("id") or link or hashlib.sha256((title+desc).encode()).hexdigest()
        out.append({"source":"rss", "external_id":str(ext)[:255], "title":str(title)[:300], "client_name":"Unknown", "description":str(desc)[:12000], "source_url":str(link)[:1200], "currency":"INR", "required_skills":[], "published_at":item.get("published") or item.get("updated") or ""})
    return out


def parse_json_api(url: str):
    """Read a user-configured public JSON job feed; redirects are deliberately disabled."""
    validate_feed_url(url)
    try:
        with httpx.stream(
            "GET", url, timeout=15, follow_redirects=False,
            headers={"User-Agent": "FreelanceIncomeAI/0.7 public-feed-reader", "Accept": "application/json"},
        ) as response:
            response.raise_for_status()
            content_type = response.headers.get("content-type", "").lower()
            if "json" not in content_type and "text/plain" not in content_type:
                raise ConnectorError("JSON source did not return a JSON content type")
            chunks = []
            size = 0
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > 5 * 1024 * 1024:
                    raise ConnectorError("JSON source response exceeds the 5 MB limit")
                chunks.append(chunk)
            payload = json.loads(b"".join(chunks).decode("utf-8"))
    except ConnectorError:
        raise
    except (httpx.HTTPError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ConnectorError("JSON source could not be fetched or parsed") from exc

    rows = payload if isinstance(payload, list) else None
    if rows is None and isinstance(payload, dict):
        for key in ("jobs", "results", "items", "data"):
            candidate = payload.get(key)
            if isinstance(candidate, list):
                rows = candidate
                break
            if isinstance(candidate, dict):
                for nested in ("jobs", "results", "items"):
                    if isinstance(candidate.get(nested), list):
                        rows = candidate[nested]
                        break
            if rows is not None:
                break
    if rows is None:
        raise ConnectorError("JSON source must contain a list or jobs/results/items/data list")

    out = []
    for row in rows[:settings.max_rss_items_per_feed]:
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or row.get("name") or "").strip()
        description = str(row.get("description") or row.get("summary") or row.get("content") or "").strip()
        if len(title) < 3 or len(description) < 10:
            continue
        link = str(row.get("url") or row.get("link") or row.get("job_url") or "").strip()
        external = row.get("id") or row.get("guid") or link
        if not external:
            external = hashlib.sha256((title + description).encode("utf-8")).hexdigest()
        skills = row.get("skills") or row.get("tags") or []
        if isinstance(skills, str):
            skills = [part.strip() for part in re.split(r"[,;|]", skills) if part.strip()]
        if not isinstance(skills, list):
            skills = []
        budget_min = row.get("budget_min")
        budget_max = row.get("budget_max")
        try:
            budget_min = float(budget_min) if budget_min is not None else None
        except (TypeError, ValueError):
            budget_min = None
        try:
            budget_max = float(budget_max) if budget_max is not None else None
        except (TypeError, ValueError):
            budget_max = None
        out.append({
            "source": "json_api",
            "external_id": str(external)[:255],
            "title": title[:300],
            "client_name": str(row.get("company") or row.get("client") or "Unknown")[:200],
            "description": description[:12000],
            "source_url": link[:1200],
            "currency": str(row.get("currency") or "INR")[:8],
            "required_skills": [str(x)[:80] for x in skills[:30]],
            "budget_min": budget_min,
            "budget_max": budget_max,
            "deadline": str(row.get("deadline") or row.get("due_date") or "")[:80],
            "job_type": str(row.get("job_type") or row.get("type") or "unknown")[:30],
            "industry": str(row.get("industry") or "")[:100],
            "published_at": str(row.get("published_at") or row.get("created_at") or "")[:80],
        })
    return out

# Connector status — Release 0.7

| Source | Status | What is needed |
|---|---|---|
| Manual entry | Implemented | None |
| Public HTTPS RSS | Implemented | A permitted RSS URL; production domain allowlist recommended |
| Public HTTPS Atom | Implemented through feedparser | A permitted Atom URL |
| Public JSON feed/API | Generic adapter implemented | Public HTTPS endpoint returning a supported JSON list shape; terms must permit automated access |
| Upwork | Not implemented | Approved API app credentials, OAuth and provider-specific adapter |
| Freelancer | Not implemented | Current official API access and OAuth credentials |
| LinkedIn | Not implemented | Approved partner/API access; do not scrape logged-in pages |
| Contra | Not implemented | Public/partner API or permitted feed confirmed by provider |
| PeoplePerHour | Not implemented | Provider-approved API/feed access |
| Email intake | Not implemented | Email connector/OAuth and user consent |

## Generic JSON adapter
Accepts a top-level list or a list nested under `jobs`, `results`, `items`, or `data`. Common field aliases are normalized; see `docs/RELEASE_0.7_MULTI_SOURCE_DISCOVERY.md`.

The generic JSON adapter is not a marketplace-specific integration. It does not support private credentials, OAuth, CAPTCHAs, paywalls or sites that disallow automated access.

Every connector must preserve source attribution, deduplicate safely, limit request size, handle rate limits, and respect provider terms. External proposal submission requires a separate implementation and explicit user approval.

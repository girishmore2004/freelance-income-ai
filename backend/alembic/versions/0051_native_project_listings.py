"""Native project listings: categories, listings and immutable versions (Phase 2).

Revision ID: 0051_native_project_listings
Revises: 0050_identity_roles_orgs

* ``project_categories``: work categories with a workflow template (inputs,
  stages, acceptance guidance) taken from Master Plan v2 Part A. Only
  ``website_development`` is enabled by default — the first of the plan's
  suggested launch categories — pending founder decision D-6.
* ``project_listings``: a client organisation's project with its lifecycle
  (Master Plan "Listing states": draft → moderation → published → hiring →
  closed; alternatives paused, expired, cancelled), visibility and moderation.
* ``project_listing_versions``: every edit creates a new immutable version
  with a content hash; money is stored in integer minor units.

Downgrade drops the three tables (new, no pre-existing data).
"""

import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0051_native_project_listings"
down_revision = "0050_identity_roles_orgs"
branch_labels = None
depends_on = None

STATUSES = "('draft', 'in_review', 'published', 'hiring', 'paused', 'closed', 'cancelled', 'expired')"

CATEGORIES = [
    {
        "slug": "website_development", "name": "Website development", "enabled": True, "sort": 10,
        "description": "Business websites, landing pages and web applications.",
        "template": {
            "inputs": ["Business purpose", "Pages", "Features", "Design references", "Hosting and domain ownership",
                       "CMS or technology preference", "Content responsibilities", "Integrations", "Testing expectations",
                       "Source-code and maintenance requirements"],
            "stages": ["Discovery and sitemap", "Wireframes or design direction", "Design approval", "Development",
                       "Content and integrations", "Staging review", "Defect correction", "Launch approval", "Deployment", "Handover"],
            "acceptance": ["Agreed pages exist", "Required functionality works", "Agreed responsive behaviour passes",
                           "Forms and integrations are tested", "Source and deployment materials are delivered as agreed"],
            "default_revisions": 2,
        },
    },
    {
        "slug": "mobile_app", "name": "Mobile app development", "enabled": False, "sort": 20,
        "description": "Android and iOS applications.",
        "template": {
            "inputs": ["Android, iOS or both", "User types", "Required features", "Backend requirements",
                       "Login and payment requirements", "Notifications", "Store accounts", "Maintenance scope"],
            "stages": ["Requirements", "User flows", "UI design", "Application development", "Backend integration",
                       "Device testing", "Bug correction", "Release package", "Store submission, if included", "Handover"],
            "acceptance": ["State whether acceptance means a submission-ready build or actual store approval"],
            "default_revisions": 2,
        },
    },
    {
        "slug": "ui_ux_design", "name": "UI/UX design", "enabled": False, "sort": 30,
        "description": "User flows, wireframes, high-fidelity designs and prototypes.",
        "template": {
            "inputs": ["Audience", "Product goals", "Screens", "Brand assets", "References"],
            "stages": ["Collect inputs", "Confirm user flows", "Wireframes", "Review direction", "High-fidelity designs",
                       "Prototype", "Resolve agreed revisions", "Deliver source design files", "Developer handover"],
            "acceptance": ["Agreed screens, flows and files are delivered (not an undefined requirement to like everything)"],
            "default_revisions": 2,
        },
    },
    {
        "slug": "graphic_design", "name": "Graphic design", "enabled": False, "sort": 40,
        "description": "Logos, social creatives, packaging, presentations and brand identity.",
        "template": {
            "inputs": ["Brand and intended use", "Concept count", "Deliverables and dimensions", "References and licensing"],
            "stages": ["Confirm brand and use", "Define concept count", "Define deliverables and dimensions",
                       "Confirm references and licensing", "Submit concepts", "Client selects direction",
                       "Complete revisions", "Deliver exports", "Deliver editable source files if included",
                       "Confirm ownership and third-party licence limits"],
            "acceptance": ["Agreed concepts, exports and source files are delivered"],
            "default_revisions": 2,
        },
    },
    {
        "slug": "video_audio", "name": "Video and audio editing", "enabled": False, "sort": 50,
        "description": "Editing, captions and exports from client-supplied media.",
        "template": {
            "inputs": ["Raw assets", "Script", "Length", "Style", "Formats", "Captions", "Music rights"],
            "stages": ["Receive raw assets", "Check asset completeness", "Confirm script, length, style, formats, captions and music rights",
                       "Rough cut", "Time-coded consolidated feedback", "Revisions", "Export final versions",
                       "Deliver project files if included", "Confirm acceptance"],
            "acceptance": ["Final versions match the agreed length, formats and captions"],
            "default_revisions": 2,
        },
    },
    {
        "slug": "writing_editing", "name": "Writing and editing", "enabled": False, "sort": 60,
        "description": "Articles, copy and editing.",
        "template": {
            "inputs": ["Topic", "Audience", "Tone", "Length", "References", "AI-use policy"],
            "stages": ["Confirm brief", "Agree outline", "Submit draft", "Factual and editorial review", "Revisions",
                       "Deliver final document", "Publication support if included"],
            "acceptance": ["Final document matches the agreed outline, length and tone"],
            "default_revisions": 2,
        },
    },
    {
        "slug": "translation", "name": "Translation", "enabled": False, "sort": 70,
        "description": "Ordinary (non-certified) translation.",
        "template": {
            "inputs": ["Language pair and locale", "Domain and glossary", "Word count and formatting"],
            "stages": ["Confirm language pair", "Confirm domain and glossary", "Confirm word count and formatting",
                       "Approve sample or terminology", "Translate batches", "Quality review", "Resolve corrections", "Deliver final files"],
            "acceptance": ["Agreed files are translated in the agreed locale and format"],
            "default_revisions": 1,
        },
    },
    {
        "slug": "seo_marketing", "name": "SEO and marketing", "enabled": False, "sort": 80,
        "description": "Audits, strategy, execution and reporting.",
        "template": {
            "inputs": ["Business goals and baseline", "Access permissions", "Deliverables and reporting"],
            "stages": ["Goals and baseline", "Confirm access", "Audit", "Approve strategy", "Define deliverables and reporting",
                       "Execute", "Report", "Optimise", "Review the period", "Renew or close"],
            "acceptance": ["Agreed work and reporting are delivered (no guaranteed rankings, leads or revenue)"],
            "default_revisions": 1,
        },
    },
]


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def upgrade():
    tables = _tables()
    if "organizations" not in tables:
        raise RuntimeError("organizations does not exist. Apply 0050 first.")
    now = sa.text("CURRENT_TIMESTAMP")

    if "project_categories" not in tables:
        op.create_table(
            "project_categories",
            sa.Column("slug", sa.String(60), primary_key=True),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("description", sa.String(400), nullable=False, server_default=""),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="100"),
            sa.Column("template_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        )

    if "project_listings" not in tables:
        op.create_table(
            "project_listings",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("category_slug", sa.String(60), sa.ForeignKey("project_categories.slug"), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
            sa.Column("visibility", sa.String(20), nullable=False, server_default="public"),
            sa.Column("moderation_status", sa.String(20), nullable=False, server_default="not_screened"),
            sa.Column("moderation_notes", sa.Text(), nullable=False, server_default=""),
            sa.Column("current_version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("closes_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.CheckConstraint(f"status IN {STATUSES}", name="ck_project_listings_status"),
            sa.CheckConstraint("visibility IN ('public', 'invite_only', 'private')", name="ck_project_listings_visibility"),
            sa.CheckConstraint("moderation_status IN ('not_screened', 'passed', 'flagged', 'approved', 'rejected')", name="ck_project_listings_moderation"),
        )
        op.create_index("ix_project_listings_org_created", "project_listings", ["organization_id", "created_at"])
        op.create_index("ix_project_listings_status_published", "project_listings", ["status", "published_at"])
        op.create_index("ix_project_listings_category", "project_listings", ["category_slug"])

    if "project_listing_versions" not in tables:
        op.create_table(
            "project_listing_versions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("listing_id", sa.String(36), sa.ForeignKey("project_listings.id", ondelete="CASCADE"), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("title", sa.String(160), nullable=False),
            sa.Column("category_slug", sa.String(60), nullable=False),
            sa.Column("outcome", sa.Text(), nullable=False, server_default=""),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("deliverables_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("skills_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("experience_level", sa.String(20), nullable=False, server_default="any"),
            sa.Column("budget_model", sa.String(20), nullable=False, server_default="fixed"),
            sa.Column("budget_min_minor", sa.BigInteger(), nullable=True),
            sa.Column("budget_max_minor", sa.BigInteger(), nullable=True),
            sa.Column("currency", sa.String(3), nullable=False, server_default="INR"),
            sa.Column("deadline", sa.Date(), nullable=True),
            sa.Column("milestones_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("acceptance_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("revision_rounds", sa.Integer(), nullable=False, server_default="2"),
            sa.Column("languages_json", sa.Text(), nullable=False, server_default='["en"]'),
            sa.Column("timezone", sa.String(60), nullable=False, server_default=""),
            sa.Column("confidentiality", sa.String(20), nullable=False, server_default="standard"),
            sa.Column("ownership_notes", sa.Text(), nullable=False, server_default=""),
            sa.Column("assumptions_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("content_hash", sa.String(64), nullable=False),
            sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.UniqueConstraint("listing_id", "version", name="uq_listing_version"),
            sa.CheckConstraint("budget_model IN ('fixed', 'hourly')", name="ck_listing_versions_budget_model"),
            sa.CheckConstraint("budget_min_minor IS NULL OR budget_min_minor >= 0", name="ck_listing_versions_budget_min"),
            sa.CheckConstraint("budget_max_minor IS NULL OR budget_min_minor IS NULL OR budget_max_minor >= budget_min_minor", name="ck_listing_versions_budget_range"),
            sa.CheckConstraint("confidentiality IN ('standard', 'confidential')", name="ck_listing_versions_confidentiality"),
            sa.CheckConstraint("experience_level IN ('any', 'entry', 'intermediate', 'expert')", name="ck_listing_versions_experience"),
            sa.CheckConstraint("revision_rounds >= 0 AND revision_rounds <= 10", name="ck_listing_versions_revisions"),
        )

    bind = op.get_bind()
    for category in CATEGORIES:
        exists = bind.execute(sa.text("SELECT 1 FROM project_categories WHERE slug = :slug"), {"slug": category["slug"]}).first()
        if not exists:
            bind.execute(
                sa.text(
                    "INSERT INTO project_categories (slug, name, description, enabled, sort_order, template_json, created_at, updated_at) "
                    "VALUES (:slug, :name, :description, :enabled, :sort, :template, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                ),
                {
                    "slug": category["slug"], "name": category["name"], "description": category["description"],
                    "enabled": category["enabled"], "sort": category["sort"], "template": json.dumps(category["template"]),
                },
            )


def downgrade():
    tables = _tables()
    for name in ("project_listing_versions", "project_listings", "project_categories"):
        if name in tables:
            op.drop_table(name)

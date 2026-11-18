import uuid
from datetime import date, datetime, timezone
from sqlalchemy import String, Text, DateTime, Date, Float, Integer, BigInteger, ForeignKey, Boolean, UniqueConstraint, Index, CheckConstraint, func, text as sql_text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import JSON
from pgvector.sqlalchemy import Vector
from .database import Base
def uid(): return str(uuid.uuid4())
def now(): return datetime.now(timezone.utc)
class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    mfa_secret_encrypted: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    mfa_last_used_step: Mapped[int | None] = mapped_column(Integer, nullable=True)
    failed_login_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    profile = relationship("Profile", back_populates="user", uselist=False, cascade="all, delete-orphan")

class AuthSession(Base):
    __tablename__ = "auth_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    token_id: Mapped[str] = mapped_column(String(36), unique=True, index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class EmailActionToken(Base):
    __tablename__ = "email_action_tokens"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    purpose: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
class MFARecoveryCode(Base):
    __tablename__ = "mfa_recovery_codes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MFAChallenge(Base):
    __tablename__ = "mfa_challenges"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    challenge_id: Mapped[str] = mapped_column(String(36), unique=True, index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")


class Profile(Base):
    __tablename__ = "profiles"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    full_name: Mapped[str] = mapped_column(String(160), default="")
    headline: Mapped[str] = mapped_column(String(240), default="")
    bio: Mapped[str] = mapped_column(Text, default="")
    skills: Mapped[str] = mapped_column(Text, default="[]")
    services: Mapped[str] = mapped_column(Text, default="[]")
    portfolio_links: Mapped[str] = mapped_column(Text, default="[]")
    minimum_budget: Mapped[float] = mapped_column(Float, default=5000)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    weekly_hours: Mapped[int] = mapped_column(Integer, default=10)
    hourly_rate: Mapped[float] = mapped_column(Float, default=0)
    timezone: Mapped[str] = mapped_column(String(80), default="Asia/Kolkata")
    preferred_work_types: Mapped[str] = mapped_column(Text, default="[\"fixed\", \"hourly\"]")
    preferred_industries: Mapped[str] = mapped_column(Text, default="[]")
    dealbreakers: Mapped[str] = mapped_column(Text, default="[]")
    # Opt-in to being suggested to clients (migration 0052). Off by default.
    marketplace_visible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    marketplace_visible_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    user = relationship("User", back_populates="profile")
class Opportunity(Base):
    __tablename__ = "opportunities"
    __table_args__ = (UniqueConstraint("user_id", "source", "external_id", name="uq_user_source_external"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(80), default="manual")
    external_id: Mapped[str] = mapped_column(String(255), default="")
    title: Mapped[str] = mapped_column(String(300))
    client_name: Mapped[str] = mapped_column(String(200), default="Unknown")
    description: Mapped[str] = mapped_column(Text)
    source_url: Mapped[str] = mapped_column(String(1200), default="")
    budget_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    budget_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    required_skills: Mapped[str] = mapped_column(Text, default="[]")
    deadline: Mapped[str] = mapped_column(String(80), default="")
    job_type: Mapped[str] = mapped_column(String(30), default="unknown")
    industry: Mapped[str] = mapped_column(String(100), default="")
    estimated_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    competition_level: Mapped[str] = mapped_column(String(20), default="unknown")
    client_rating: Mapped[float | None] = mapped_column(Float, nullable=True)
    client_reviews: Mapped[int | None] = mapped_column(Integer, nullable=True)
    client_payment_verified: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    status: Mapped[str] = mapped_column(String(40), default="new")
    match_score: Mapped[int] = mapped_column(Integer, default=0)
    score_breakdown: Mapped[str] = mapped_column(Text, default="{}")
    source_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    first_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duplicate_count: Mapped[int] = mapped_column(Integer, default=0)
    source_origins: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
class OpportunityReview(Base):
    """User-owned shortlist decision and next-action reminder for an opportunity."""
    __tablename__ = "opportunity_reviews"
    __table_args__ = (UniqueConstraint("user_id", "opportunity_id", name="uq_user_opportunity_review"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    opportunity_id: Mapped[str] = mapped_column(ForeignKey("opportunities.id", ondelete="CASCADE"), index=True)
    decision: Mapped[str] = mapped_column(String(30), default="saved")
    notes: Mapped[str] = mapped_column(Text, default="")
    next_action_date: Mapped[str] = mapped_column(String(10), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class Proposal(Base):
    __tablename__ = "proposals"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    opportunity_id: Mapped[str] = mapped_column(ForeignKey("opportunities.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    content: Mapped[str] = mapped_column(Text)
    proposed_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    status: Mapped[str] = mapped_column(String(40), default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
class Approval(Base):
    __tablename__ = "approvals"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    proposal_id: Mapped[str] = mapped_column(ForeignKey("proposals.id", ondelete="CASCADE"), index=True)
    decision: Mapped[str] = mapped_column(String(30), default="pending")
    proposal_hash: Mapped[str] = mapped_column(String(64))
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
class Client(Base):
    __tablename__ = "clients"
    __table_args__ = (UniqueConstraint("user_id", "email", name="uq_client_user_email"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    company: Mapped[str] = mapped_column(String(200), default="")
    email: Mapped[str | None] = mapped_column(String(320), nullable=True, default=None)
    phone: Mapped[str] = mapped_column(String(40), default="")
    website: Mapped[str] = mapped_column(String(1200), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[str] = mapped_column(Text, default="[]")
    status: Mapped[str] = mapped_column(String(30), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class ScopeChangeRequest(Base):
    __tablename__ = "scope_change_requests"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(240))
    description: Mapped[str] = mapped_column(Text)
    reason: Mapped[str] = mapped_column(Text, default="")
    budget_delta: Mapped[float] = mapped_column(Float, default=0)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    timeline_delta_days: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(30), default="draft")
    request_hash: Mapped[str] = mapped_column(String(64), default="")
    decision_note: Mapped[str] = mapped_column(Text, default="")
    client_accepted: Mapped[bool] = mapped_column(Boolean, default=False)
    client_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ClientContract(Base):
    __tablename__ = "client_contracts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(240))
    contract_type: Mapped[str] = mapped_column(String(30), default="statement_of_work")
    version: Mapped[int] = mapped_column(Integer, default=1)
    content: Mapped[str] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(String(64), default="")
    status: Mapped[str] = mapped_column(String(30), default="draft")
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    value: Mapped[float] = mapped_column(Float, default=0)
    expires_on: Mapped[str] = mapped_column(String(10), default="")
    decision_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class ClientContractRevision(Base):
    __tablename__ = "client_contract_revisions"
    __table_args__ = (UniqueConstraint("user_id", "contract_id", "version", name="uq_contract_revision_version"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    contract_id: Mapped[str] = mapped_column(ForeignKey("client_contracts.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(240))
    contract_type: Mapped[str] = mapped_column(String(30))
    content: Mapped[str] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(String(64))
    previous_hash: Mapped[str] = mapped_column(String(64), default="")
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    value: Mapped[float] = mapped_column(Float, default=0)
    expires_on: Mapped[str] = mapped_column(String(10), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class DeliverableAcceptanceEvent(Base):
    __tablename__ = "deliverable_acceptance_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    deliverable_id: Mapped[str] = mapped_column(ForeignKey("project_deliverables.id", ondelete="CASCADE"), index=True)
    revision_version: Mapped[int] = mapped_column(Integer, default=1)
    content_hash: Mapped[str] = mapped_column(String(64), default="")
    decision: Mapped[str] = mapped_column(String(30))
    note: Mapped[str] = mapped_column(Text, default="")
    evidence_reference: Mapped[str] = mapped_column(Text, default="")
    recorded_by: Mapped[str] = mapped_column(String(30), default="workspace_owner")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ClientCommunicationLog(Base):
    __tablename__ = "client_communication_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True)
    channel: Mapped[str] = mapped_column(String(30), default="note")
    direction: Mapped[str] = mapped_column(String(20), default="internal")
    subject: Mapped[str] = mapped_column(String(300), default="")
    body: Mapped[str] = mapped_column(Text)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[str | None] = mapped_column(ForeignKey("clients.id", ondelete="SET NULL"), nullable=True, index=True)
    origin_opportunity_id: Mapped[str | None] = mapped_column(ForeignKey("opportunities.id", ondelete="SET NULL"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(300))
    client_name: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(40), default="active")
    delivery_audit_head_hash: Mapped[str] = mapped_column(String(64), default="", server_default="")
    budget: Mapped[float] = mapped_column(Float, default=0)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    due_date: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
class Invoice(Base):
    __tablename__ = "invoices"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    invoice_number: Mapped[str] = mapped_column(String(80))
    amount: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    due_date: Mapped[str] = mapped_column(String(80), default="")
    status: Mapped[str] = mapped_column(String(30), default="unpaid")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class ClientCostEntry(Base):
    """Manually recorded direct client/project cost; no bank integration."""
    __tablename__ = "client_cost_entries"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True)
    category: Mapped[str] = mapped_column(String(40), default="other")
    description: Mapped[str] = mapped_column(String(300))
    amount: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    cost_date: Mapped[str] = mapped_column(String(10))
    evidence_reference: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class InvoicePaymentEvent(Base):
    """Append-only manual payment evidence; no payment processor is connected."""
    __tablename__ = "invoice_payment_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    invoice_id: Mapped[str] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(30))
    amount: Mapped[float] = mapped_column(Float, default=0)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    reference: Mapped[str] = mapped_column(String(240), default="")
    evidence_reference: Mapped[str] = mapped_column(Text, default="")
    note: Mapped[str] = mapped_column(Text, default="")
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class AgentRun(Base):
    __tablename__ = "agent_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    agent_name: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(30), default="completed")
    summary: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ProjectTask(Base):
    __tablename__ = "project_tasks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(240))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(30), default="todo")
    priority: Mapped[str] = mapped_column(String(20), default="medium")
    due_date: Mapped[str] = mapped_column(String(80), default="")
    estimated_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    planned_start_date: Mapped[str] = mapped_column(String(10), default="")
    planned_finish_date: Mapped[str] = mapped_column(String(10), default="")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class TaskDependency(Base):
    __tablename__ = "task_dependencies"
    __table_args__ = (UniqueConstraint("user_id", "predecessor_task_id", "successor_task_id", name="uq_task_dependency_edge"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    predecessor_task_id: Mapped[str] = mapped_column(ForeignKey("project_tasks.id", ondelete="CASCADE"))
    successor_task_id: Mapped[str] = mapped_column(ForeignKey("project_tasks.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class TimeEntry(Base):
    __tablename__ = "time_entries"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[str | None] = mapped_column(ForeignKey("project_tasks.id", ondelete="SET NULL"), nullable=True, index=True)
    work_date: Mapped[str] = mapped_column(String(10), index=True)
    duration_minutes: Mapped[int] = mapped_column(Integer)
    description: Mapped[str] = mapped_column(Text, default="")
    billable: Mapped[bool] = mapped_column(Boolean, default=True)
    hourly_rate: Mapped[float] = mapped_column(Float, default=0)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Milestone(Base):
    __tablename__ = "milestones"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(240))
    description: Mapped[str] = mapped_column(Text, default="")
    amount: Mapped[float] = mapped_column(Float, default=0)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    due_date: Mapped[str] = mapped_column(String(80), default="")
    status: Mapped[str] = mapped_column(String(30), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class ClientResearch(Base):
    __tablename__ = "client_research"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    opportunity_id: Mapped[str | None] = mapped_column(ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=True, index=True)
    client_name: Mapped[str] = mapped_column(String(200))
    evidence_type: Mapped[str] = mapped_column(String(60), default="user_note")
    claim: Mapped[str] = mapped_column(Text)
    evidence_url: Mapped[str] = mapped_column(String(1200), default="")
    confidence: Mapped[str] = mapped_column(String(20), default="unverified")
    source_host: Mapped[str] = mapped_column(String(255), default="")
    evidence_hash: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ClientRiskAssessment(Base):
    __tablename__ = "client_risk_assessments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    opportunity_id: Mapped[str] = mapped_column(ForeignKey("opportunities.id", ondelete="CASCADE"), index=True)
    risk_score: Mapped[int] = mapped_column(Integer, default=0)
    risk_level: Mapped[str] = mapped_column(String(30), default="insufficient_data")
    evidence_coverage: Mapped[int] = mapped_column(Integer, default=0)
    report_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class Feedback(Base):
    __tablename__ = "feedback"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    opportunity_id: Mapped[str | None] = mapped_column(ForeignKey("opportunities.id", ondelete="SET NULL"), nullable=True)
    outcome: Mapped[str] = mapped_column(String(30))
    reason: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(240))
    message: Mapped[str] = mapped_column(Text)
    channel: Mapped[str] = mapped_column(String(30), default="in_app")
    status: Mapped[str] = mapped_column(String(30), default="queued")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    # Inbox fields (migration 0062).
    kind: Mapped[str] = mapped_column(String(60), nullable=False, default="general", server_default="general")
    link: Mapped[str] = mapped_column(String(300), nullable=False, default="", server_default="")
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dedupe_key: Mapped[str | None] = mapped_column(String(200), nullable=True, unique=True)

class PortfolioDocument(Base):
    __tablename__ = "portfolio_documents"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(120), default="text/plain")
    extracted_text: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class AgentEvent(Base):
    __tablename__ = "agent_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    agent_name: Mapped[str] = mapped_column(String(100))
    event_type: Mapped[str] = mapped_column(String(60))
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class OpportunitySource(Base):
    __tablename__ = "opportunity_sources"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160), default="RSS feed")
    source_type: Mapped[str] = mapped_column(String(30), default="rss")
    feed_url: Mapped[str] = mapped_column(String(1200))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    health_status: Mapped[str] = mapped_column(String(30), default="unknown")
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0)
    total_items_seen: Mapped[int] = mapped_column(Integer, default=0)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class BackgroundJob(Base):
    __tablename__ = "background_jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    job_type: Mapped[str] = mapped_column(String(80), index=True)
    status: Mapped[str] = mapped_column(String(30), default="queued", index=True)
    rq_job_id: Mapped[str] = mapped_column(String(100), default="")
    result_json: Mapped[str] = mapped_column(Text, default="{}")
    error_message: Mapped[str] = mapped_column(Text, default="")
    error_code: Mapped[str] = mapped_column(String(60), default="")
    last_error_node: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Added in migration 0048 for Cloudflare Queue jobs processed by the Edge API.
    # A non-null idempotency_key makes enqueueing the same logical job a no-op.
    idempotency_key: Mapped[str | None] = mapped_column(String(200), nullable=True, unique=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}", server_default="{}")
    source: Mapped[str] = mapped_column(String(30), nullable=False, default="python", server_default="python")
    dead_lettered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class PortfolioChunk(Base):
    __tablename__ = "portfolio_chunks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("portfolio_documents.id", ondelete="CASCADE"), index=True)
    chunk_index: Mapped[int] = mapped_column(Integer, default=0)
    content: Mapped[str] = mapped_column(Text)
    embedding_json: Mapped[str] = mapped_column(Text, default="[]")
    # PostgreSQL stores vectors natively; SQLite uses JSON for local tests.
    embedding_vector: Mapped[list[float] | None] = mapped_column(
        Vector().with_variant(JSON, "sqlite"), nullable=True
    )
    embedding_model: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class WorkflowRun(Base):
    __tablename__ = "workflow_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    opportunity_id: Mapped[str] = mapped_column(ForeignKey("opportunities.id", ondelete="CASCADE"), index=True)
    proposal_id: Mapped[str | None] = mapped_column(ForeignKey("proposals.id", ondelete="SET NULL"), nullable=True, index=True)
    approval_id: Mapped[str | None] = mapped_column(ForeignKey("approvals.id", ondelete="SET NULL"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(40), default="queued", index=True)
    current_step: Mapped[str] = mapped_column(String(80), default="queued")
    state_json: Mapped[str] = mapped_column(Text, default="{}")
    proposed_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    error_message: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WorkflowCheckpoint(Base):
    __tablename__ = "workflow_checkpoints"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    workflow_id: Mapped[str] = mapped_column(ForeignKey("workflow_runs.id", ondelete="CASCADE"), index=True)
    sequence: Mapped[int] = mapped_column(Integer, index=True)
    node_name: Mapped[str] = mapped_column(String(80))
    state_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)



class EmailOAuthState(Base):
    __tablename__ = "email_oauth_states"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(20), index=True)
    state_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    code_verifier: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class EmailProviderAccount(Base):
    __tablename__ = "email_provider_accounts"
    __table_args__ = (UniqueConstraint("user_id", "provider", name="uq_email_provider_user"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(20), index=True)
    provider_email: Mapped[str | None] = mapped_column(String(320), nullable=True, default=None)
    access_token_encrypted: Mapped[str] = mapped_column(Text)
    refresh_token_encrypted: Mapped[str] = mapped_column(Text, default="")
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    scopes: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="connected")
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_sync_error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ClientEmail(Base):
    __tablename__ = "client_emails"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    opportunity_id: Mapped[str | None] = mapped_column(ForeignKey("opportunities.id", ondelete="SET NULL"), nullable=True, index=True)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True)
    provider: Mapped[str] = mapped_column(String(40), default="manual")
    external_id: Mapped[str] = mapped_column(String(255), default="")
    external_fingerprint: Mapped[str | None] = mapped_column(String(64), unique=True, index=True, nullable=True)
    provider_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    thread_id: Mapped[str] = mapped_column(String(255), default="")
    rfc_message_id: Mapped[str] = mapped_column(String(998), default="")
    sender_name: Mapped[str] = mapped_column(String(200), default="")
    sender_email: Mapped[str | None] = mapped_column(String(320), nullable=True, default=None)
    subject: Mapped[str] = mapped_column(String(500), default="")
    body_text: Mapped[str] = mapped_column(Text)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    category: Mapped[str] = mapped_column(String(40), default="general")
    priority: Mapped[str] = mapped_column(String(20), default="normal")
    sentiment: Mapped[str] = mapped_column(String(20), default="neutral")
    sentiment_evidence: Mapped[str] = mapped_column(Text, default="[]")
    urgency: Mapped[str] = mapped_column(String(20), default="low")
    urgency_score: Mapped[int] = mapped_column(Integer, default=0)
    urgency_reasons: Mapped[str] = mapped_column(Text, default="[]")
    suggested_project_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    suggested_project_score: Mapped[float] = mapped_column(Float, default=0)
    analysis_version: Mapped[str] = mapped_column(String(40), default="rules-v1")
    status: Mapped[str] = mapped_column(String(30), default="new")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class EmailDraft(Base):
    __tablename__ = "email_drafts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    email_id: Mapped[str] = mapped_column(ForeignKey("client_emails.id", ondelete="CASCADE"), index=True)
    subject: Mapped[str] = mapped_column(String(500), default="")
    body_text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default="draft")
    approval_note: Mapped[str] = mapped_column(Text, default="")
    approval_hash: Mapped[str] = mapped_column(String(64), default="")
    approved_recipient: Mapped[str] = mapped_column(String(320), default="")
    approved_provider: Mapped[str] = mapped_column(String(20), default="")
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_provider_id: Mapped[str] = mapped_column(String(255), default="")
    context_sources: Mapped[str] = mapped_column(Text, default="[]")
    generation_mode: Mapped[str] = mapped_column(String(40), default="safe_template")
    grounding_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class FollowUpReminder(Base):
    __tablename__ = "follow_up_reminders"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    email_id: Mapped[str | None] = mapped_column(ForeignKey("client_emails.id", ondelete="SET NULL"), nullable=True, index=True)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(240))
    notes: Mapped[str] = mapped_column(Text, default="")
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    status: Mapped[str] = mapped_column(String(20), default="open")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class MarketplaceConnection(Base):
    __tablename__ = "marketplace_connections"
    __table_args__ = (UniqueConstraint("user_id", "provider", name="uq_user_marketplace_provider"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(30), default="not_configured")
    access_mode: Mapped[str] = mapped_column(String(30), default="manual")
    external_account_id: Mapped[str] = mapped_column(String(255), default="")
    scopes: Mapped[str] = mapped_column(Text, default="[]")
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class MarketplaceCredential(Base):
    """Encrypted OAuth token material; never serialize this model to clients."""
    __tablename__ = "marketplace_credentials"
    __table_args__ = (UniqueConstraint("user_id", "provider", name="uq_user_marketplace_credential"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(40), index=True)
    access_token_encrypted: Mapped[str] = mapped_column(Text)
    refresh_token_encrypted: Mapped[str] = mapped_column(Text, default="")
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    scopes: Mapped[str] = mapped_column(Text, default="[]")
    status: Mapped[str] = mapped_column(String(20), default="connected")
    connected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class MarketplaceApplication(Base):
    __tablename__ = "marketplace_applications"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", "external_opportunity_id", name="uq_user_provider_external_application"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    opportunity_id: Mapped[str] = mapped_column(ForeignKey("opportunities.id", ondelete="CASCADE"), index=True)
    proposal_id: Mapped[str | None] = mapped_column(ForeignKey("proposals.id", ondelete="SET NULL"), nullable=True)
    provider: Mapped[str] = mapped_column(String(40))
    external_opportunity_id: Mapped[str] = mapped_column(String(255), default="")
    external_application_id: Mapped[str] = mapped_column(String(255), default="")
    status: Mapped[str] = mapped_column(String(30), default="draft")
    approval_hash: Mapped[str] = mapped_column(String(64), default="")
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    outcome_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class SavedMarketplaceSearch(Base):
    """User-owned recurring read-only marketplace search configuration."""
    __tablename__ = "saved_marketplace_searches"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", "search_term", name="uq_user_provider_saved_search"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(40), default="upwork")
    search_term: Mapped[str] = mapped_column(String(160))
    result_limit: Mapped[int] = mapped_column(Integer, default=20)
    interval_hours: Mapped[int] = mapped_column(Integer, default=24)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    last_result_count: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class MarketplaceAuditEvent(Base):
    __tablename__ = "marketplace_audit_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    application_id: Mapped[str | None] = mapped_column(ForeignKey("marketplace_applications.id", ondelete="SET NULL"), nullable=True, index=True)
    provider: Mapped[str] = mapped_column(String(40))
    event_type: Mapped[str] = mapped_column(String(60))
    detail: Mapped[str] = mapped_column(Text, default="")
    actor: Mapped[str] = mapped_column(String(20), default="system")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ProjectDeliverable(Base):
    __tablename__ = "project_deliverables"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[str | None] = mapped_column(ForeignKey("project_tasks.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(240))
    description: Mapped[str] = mapped_column(Text, default="")
    content_reference: Mapped[str] = mapped_column(Text, default="")
    due_date: Mapped[str] = mapped_column(String(80), default="")
    status: Mapped[str] = mapped_column(String(30), default="draft")
    review_hash: Mapped[str] = mapped_column(String(64), default="")
    review_note: Mapped[str] = mapped_column(Text, default="")
    submitted_for_review_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class DeliverableRevision(Base):
    __tablename__ = "deliverable_revisions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    deliverable_id: Mapped[str] = mapped_column(ForeignKey("project_deliverables.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(240))
    description: Mapped[str] = mapped_column(Text, default="")
    content_reference: Mapped[str] = mapped_column(Text, default="")
    change_note: Mapped[str] = mapped_column(Text, default="")
    # Explicitly selected at revision creation; legacy revisions migrate as unclassified.
    revision_origin: Mapped[str] = mapped_column(String(40), default="unclassified", server_default="unclassified")
    origin_note: Mapped[str] = mapped_column(Text, default="")
    origin_evidence_reference: Mapped[str] = mapped_column(Text, default="")
    # Immutable-at-creation links to same-deliverable client feedback or an approved project scope change.
    client_feedback_event_id: Mapped[str | None] = mapped_column(ForeignKey("deliverable_acceptance_events.id", ondelete="RESTRICT"), nullable=True, index=True)
    scope_change_request_id: Mapped[str | None] = mapped_column(ForeignKey("scope_change_requests.id", ondelete="RESTRICT"), nullable=True, index=True)
    content_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class InvoiceSchedule(Base):
    __tablename__ = "invoice_schedules"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    milestone_id: Mapped[str | None] = mapped_column(ForeignKey("milestones.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(240))
    amount: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    due_date: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(30), default="planned")
    approval_hash: Mapped[str] = mapped_column(String(64), default="")
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    invoice_id: Mapped[str | None] = mapped_column(ForeignKey("invoices.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class DeliveryIssue(Base):
    """User-managed delivery dispute and corrective-action record."""
    __tablename__ = "delivery_issues"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    deliverable_id: Mapped[str] = mapped_column(ForeignKey("project_deliverables.id", ondelete="RESTRICT"), index=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey("deliverable_revisions.id", ondelete="RESTRICT"), index=True)
    feedback_event_id: Mapped[str | None] = mapped_column(ForeignKey("deliverable_acceptance_events.id", ondelete="RESTRICT"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(240))
    description: Mapped[str] = mapped_column(Text, default="")
    severity: Mapped[str] = mapped_column(String(20), default="medium")
    root_cause: Mapped[str] = mapped_column(String(40), default="unclassified", server_default="unclassified")
    status: Mapped[str] = mapped_column(String(24), default="open")
    assigned_to: Mapped[str] = mapped_column(String(160), default="")
    corrective_action: Mapped[str] = mapped_column(Text, default="")
    due_date: Mapped[str] = mapped_column(String(10), default="")
    resolution_note: Mapped[str] = mapped_column(Text, default="")
    resolution_evidence_reference: Mapped[str] = mapped_column(Text, default="")
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class DeliveryAuditEvent(Base):
    __tablename__ = "delivery_audit_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    deliverable_id: Mapped[str | None] = mapped_column(ForeignKey("project_deliverables.id", ondelete="SET NULL"), nullable=True)
    event_type: Mapped[str] = mapped_column(String(60))
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    previous_hash: Mapped[str] = mapped_column(String(64), default="", server_default="")
    event_hash: Mapped[str] = mapped_column(String(64), default="", server_default="")
    chain_version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")



class DeliveryHandoverSnapshot(Base):
    """Immutable, versioned handover snapshot; approval is recorded separately on the row."""
    __tablename__ = "delivery_handover_snapshots"
    __table_args__ = (UniqueConstraint("user_id", "project_id", "version", name="uq_handover_snapshot_version"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    snapshot_json: Mapped[str] = mapped_column(Text)
    snapshot_hash: Mapped[str] = mapped_column(String(64))
    input_fingerprint: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(24), default="draft", server_default="draft")
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by: Mapped[str] = mapped_column(String(36), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class DeliveryCloseoutSignoff(Base):
    """Append-only human sign-off tied to one approved handover snapshot."""
    __tablename__ = "delivery_closeout_signoffs"
    __table_args__ = (UniqueConstraint("user_id", "project_id", "version", name="uq_closeout_signoff_version"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    snapshot_id: Mapped[str] = mapped_column(ForeignKey("delivery_handover_snapshots.id", ondelete="RESTRICT"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    snapshot_hash: Mapped[str] = mapped_column(String(64))
    closeout_fingerprint: Mapped[str] = mapped_column(String(64))
    signoff_role: Mapped[str] = mapped_column(String(80), default="project_owner")
    signoff_note: Mapped[str] = mapped_column(Text, default="")
    evidence_reference: Mapped[str] = mapped_column(Text, default="")
    signed_by: Mapped[str] = mapped_column(String(36))
    signed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ProjectClosureRecord(Base):
    """Immutable record of an explicit human-confirmed project closure."""
    __tablename__ = "project_closure_records"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    signoff_id: Mapped[str] = mapped_column(ForeignKey("delivery_closeout_signoffs.id", ondelete="RESTRICT"), unique=True)
    snapshot_hash: Mapped[str] = mapped_column(String(64))
    closeout_fingerprint: Mapped[str] = mapped_column(String(64))
    confirmation_phrase: Mapped[str] = mapped_column(String(40))
    closed_by: Mapped[str] = mapped_column(String(36))
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    closure_note: Mapped[str] = mapped_column(Text, default="")


class DeliveryArchiveManifest(Base):
    """Immutable archive manifest for a closed project."""
    __tablename__ = "delivery_archive_manifests"
    __table_args__ = (UniqueConstraint("user_id", "project_id", "version", name="uq_archive_manifest_version"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    manifest_json: Mapped[str] = mapped_column(Text)
    manifest_hash: Mapped[str] = mapped_column(String(64))
    created_by: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ArchiveSupersessionRecord(Base):
    """Immutable link declaring that a newer archive supersedes an older version."""
    __tablename__ = "archive_supersession_records"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    superseded_manifest_id: Mapped[str] = mapped_column(ForeignKey("delivery_archive_manifests.id", ondelete="RESTRICT"), unique=True)
    replacement_manifest_id: Mapped[str] = mapped_column(ForeignKey("delivery_archive_manifests.id", ondelete="RESTRICT"), index=True)
    reason: Mapped[str] = mapped_column(Text)
    created_by: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ProjectRecoveryRehearsal(Base):
    """Immutable checklist record for a human-run project archive recovery rehearsal."""
    __tablename__ = "project_recovery_rehearsals"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    archive_manifest_id: Mapped[str] = mapped_column(ForeignKey("delivery_archive_manifests.id", ondelete="RESTRICT"), index=True)
    overall_status: Mapped[str] = mapped_column(String(24))
    checklist_json: Mapped[str] = mapped_column(Text)
    notes: Mapped[str] = mapped_column(Text, default="")
    performed_by: Mapped[str] = mapped_column(String(36))
    performed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ProjectRetentionPolicy(Base):
    """User-approved archive review period; never triggers automatic deletion."""
    __tablename__ = "project_retention_policies"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)
    retention_days: Mapped[int] = mapped_column(Integer, default=365)
    approved_by: Mapped[str] = mapped_column(String(36), default="")
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ProjectRetentionReview(Base):
    """Append-only proposal and human decision for retention policy changes."""
    __tablename__ = "project_retention_reviews"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    proposed_days: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    reason: Mapped[str] = mapped_column(Text, default="")
    requested_by: Mapped[str] = mapped_column(String(36))
    decided_by: Mapped[str] = mapped_column(String(36), default="")
    decision_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class BusinessGoal(Base):
    __tablename__ = "business_goals"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)
    monthly_income_target: Mapped[float] = mapped_column(Float, default=0)
    weekly_hours_target: Mapped[float] = mapped_column(Float, default=10)
    monthly_proposals_target: Mapped[int] = mapped_column(Integer, default=4)
    monthly_outreach_target: Mapped[int] = mapped_column(Integer, default=10)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class BusinessWorkspaceEvent(Base):
    __tablename__ = "business_workspace_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(60), index=True)
    entity_type: Mapped[str] = mapped_column(String(60), default="")
    entity_id: Mapped[str] = mapped_column(String(36), default="")
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class CoachInteraction(Base):
    __tablename__ = "coach_interactions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text)
    sources_json: Mapped[str] = mapped_column(Text, default="[]")
    generation_mode: Mapped[str] = mapped_column(String(40), default="rules_fallback")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)



class AgentWorkflowRun(Base):
    __tablename__ = "agent_workflow_runs"
    __table_args__ = (UniqueConstraint("user_id", "idempotency_key", name="uq_agent_workflow_user_idempotency"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    workflow_type: Mapped[str] = mapped_column(String(40), default="business_review")
    idempotency_key: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(30), default="queued", index=True)
    current_step: Mapped[str] = mapped_column(String(80), default="queued")
    state_json: Mapped[str] = mapped_column(Text, default="{}")
    result_json: Mapped[str] = mapped_column(Text, default="{}")
    error_message: Mapped[str] = mapped_column(Text, default="")
    rq_job_id: Mapped[str] = mapped_column(String(100), default="")
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AgentWorkflowCheckpoint(Base):
    __tablename__ = "agent_workflow_checkpoints"
    __table_args__ = (UniqueConstraint("workflow_id", "sequence", name="uq_agent_workflow_checkpoint_sequence"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    workflow_id: Mapped[str] = mapped_column(ForeignKey("agent_workflow_runs.id", ondelete="CASCADE"), index=True)
    sequence: Mapped[int] = mapped_column(Integer)
    node_name: Mapped[str] = mapped_column(String(80))
    state_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AIUsageEvent(Base):
    __tablename__ = "ai_usage_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    operation: Mapped[str] = mapped_column(String(80))
    provider: Mapped[str] = mapped_column(String(40))
    input_chars: Mapped[int] = mapped_column(Integer, default=0)
    output_chars: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    # Migration 0049: estimated provider cost in micro-USD (1e-6 USD) and the
    # service that made the call, for global spend caps and cost reporting.
    # Estimates only; provider invoices remain the accounting source of truth.
    estimated_cost_micros: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    service: Mapped[str] = mapped_column(String(20), nullable=False, default="python", server_default="python")

class AbuseEvent(Base):
    __tablename__ = "abuse_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(80), index=True)
    detail: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)

class CalendarAvailabilityBlock(Base):
    """User-entered unavailable time for leave, holidays or personal commitments."""
    __tablename__ = "calendar_availability_blocks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    block_date: Mapped[str] = mapped_column(String(10), index=True)
    unavailable_hours: Mapped[float] = mapped_column(Float, default=0)
    kind: Mapped[str] = mapped_column(String(30), default="personal")
    note: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class SchedulePlanVersion(Base):
    """Immutable schedule proposal snapshot and approval/audit lifecycle."""
    __tablename__ = "schedule_plan_versions"
    __table_args__ = (UniqueConstraint("user_id", "version", name="uq_schedule_plan_user_version"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    input_fingerprint: Mapped[str] = mapped_column(String(64))
    snapshot: Mapped[dict] = mapped_column(JSON)
    before_after: Mapped[dict] = mapped_column(JSON, default=dict)
    decision_reason: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# ---------------------------------------------------------------------------
# Edge API owned tables (release 5.46.0, migration 0047).
#
# These tables were used by the Cloudflare Edge API (apply/reply agent and
# Gmail integration) but were never captured in models or migrations. Column
# names, defaults and constraints match the SQL issued by
# backend/edge-api/src/lib/apply-routes.ts and apply-agent.ts. The Python
# service does not read or write them; the Edge API is the owning service.
# ---------------------------------------------------------------------------


class EdgeIntegration(Base):
    """Per-user OAuth integration used by the Edge apply agent (Gmail).

    Tokens are stored encrypted by the Edge API (AES-GCM, OAUTH_ENCRYPTION_KEY).
    The Edge INSERT omits ``id``; on PostgreSQL migration 0047 sets
    ``DEFAULT gen_random_uuid()::text`` so the database generates it.
    """
    __tablename__ = "integrations"
    __table_args__ = (UniqueConstraint("user_id", "provider", name="uq_integrations_user_provider"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)  # PostgreSQL server default set by migration 0047
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False, default="", server_default="")
    refresh_token: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    access_token: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now, server_default=func.now(), nullable=False)


class EdgeApplication(Base):
    """An approved proposal sent by the Edge apply agent (email/Freelancer.com)."""
    __tablename__ = "applications"
    __table_args__ = (
        Index("ix_applications_user_created", "user_id", "created_at"),
        Index("ix_applications_status_created", "status", "created_at"),
        # One live send per proposal: makes the W2 "send proposal" action idempotent
        # even under concurrent requests (the route also checks before inserting).
        Index(
            "uq_applications_live_proposal",
            "proposal_id",
            unique=True,
            postgresql_where=sql_text("status IN ('sending', 'sent', 'replied')"),
            sqlite_where=sql_text("status IN ('sending', 'sent', 'replied')"),
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    opportunity_id: Mapped[str] = mapped_column(ForeignKey("opportunities.id", ondelete="CASCADE"), index=True, nullable=False)
    proposal_id: Mapped[str | None] = mapped_column(ForeignKey("proposals.id", ondelete="SET NULL"), nullable=True)
    channel: Mapped[str] = mapped_column(String(30), nullable=False, default="manual", server_default="manual")
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="sent", server_default="sent")
    recipient: Mapped[str] = mapped_column(String(320), nullable=False, default="", server_default="")
    external_ref: Mapped[str] = mapped_column(String(255), nullable=False, default="", server_default="")
    thread_id: Mapped[str] = mapped_column(String(255), nullable=False, default="", server_default="")
    extra: Mapped[str] = mapped_column(Text, nullable=False, default="{}", server_default="{}")
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class EdgeApplicationMessage(Base):
    """Inbound client reply or outbound user reply on an Edge application thread."""
    __tablename__ = "application_messages"
    __table_args__ = (
        UniqueConstraint("user_id", "external_id", name="uq_application_messages_user_external"),
        Index("ix_application_messages_app_received", "application_id", "received_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), nullable=False)
    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    sender: Mapped[str] = mapped_column(String(300), nullable=False, default="", server_default="")
    subject: Mapped[str] = mapped_column(String(300), nullable=False, default="", server_default="")
    body: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    external_id: Mapped[str] = mapped_column(String(255), nullable=False)
    message_ref: Mapped[str] = mapped_column(String(500), nullable=False, default="", server_default="")
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)
    ai_label: Mapped[str] = mapped_column(String(40), nullable=False, default="", server_default="")
    ai_summary: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    ai_suggestion: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class FeatureFlag(Base):
    """Server-side feature flag / kill switch (migration 0049).

    Read by the Edge API on each request that needs it. An environment
    variable FEATURE_FLAGS_OFF can force any flag off without a database write.
    """
    __tablename__ = "feature_flags"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    description: Mapped[str] = mapped_column(String(300), nullable=False, default="", server_default="")
    owner: Mapped[str] = mapped_column(String(80), nullable=False, default="", server_default="")
    updated_by: Mapped[str] = mapped_column(String(80), nullable=False, default="", server_default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now, server_default=func.now(), nullable=False)


# ---------------------------------------------------------------------------
# Identity: roles, organisations, memberships (migration 0050, Phase 1).
# Owned by the Edge API (/api/v1/me, /api/v1/organizations).
# ---------------------------------------------------------------------------

USER_ROLE_VALUES = ("freelancer", "client", "admin", "support", "moderator", "finance")
PUBLIC_ROLE_VALUES = ("freelancer", "client")


class UserRole(Base):
    """One row per role a user holds.

    Public roles (freelancer, client) are self-activated. Internal roles
    (admin, support, moderator, finance) are granted only by staff and are
    never assignable through public endpoints.
    """
    __tablename__ = "user_roles"
    __table_args__ = (
        UniqueConstraint("user_id", "role", name="uq_user_roles_user_role"),
        CheckConstraint("role IN ('freelancer', 'client', 'admin', 'support', 'moderator', 'finance')", name="ck_user_roles_role"),
        CheckConstraint("status IN ('active', 'inactive', 'suspended')", name="ck_user_roles_status"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", server_default="active")
    granted_by: Mapped[str] = mapped_column(String(80), nullable=False, default="self", server_default="self")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now, server_default=func.now(), nullable=False)


class Organization(Base):
    """A client account: an individual or a company that hires freelancers.

    Billing identity lives here so that projects, agreements and invoices can
    later belong to the organisation rather than to one person.
    """
    __tablename__ = "organizations"
    __table_args__ = (
        CheckConstraint("kind IN ('individual', 'company')", name="ck_organizations_kind"),
        CheckConstraint("status IN ('active', 'suspended', 'closed')", name="ck_organizations_status"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="individual", server_default="individual")
    industry: Mapped[str] = mapped_column(String(120), nullable=False, default="", server_default="")
    website: Mapped[str] = mapped_column(String(300), nullable=False, default="", server_default="")
    country: Mapped[str] = mapped_column(String(2), nullable=False, default="IN", server_default="IN")
    preferred_language: Mapped[str] = mapped_column(String(20), nullable=False, default="en", server_default="en")
    billing_name: Mapped[str] = mapped_column(String(200), nullable=False, default="", server_default="")
    billing_email: Mapped[str] = mapped_column(String(320), nullable=False, default="", server_default="")
    billing_address: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    tax_id: Mapped[str] = mapped_column(String(40), nullable=False, default="", server_default="")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", server_default="active")
    # Audit only; ownership is the "owner" membership. SET NULL so deleting an account is never blocked.
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now, server_default=func.now(), nullable=False)


class OrganizationMembership(Base):
    """A user's membership of an organisation (owner, admin or member)."""
    __tablename__ = "organization_memberships"
    __table_args__ = (
        UniqueConstraint("organization_id", "user_id", name="uq_org_membership"),
        CheckConstraint("role IN ('owner', 'admin', 'member')", name="ck_org_membership_role"),
        CheckConstraint("status IN ('active', 'invited', 'removed')", name="ck_org_membership_status"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="member", server_default="member")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", server_default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


# ---------------------------------------------------------------------------
# Native project listings (migration 0051, Phase 2). Owned by the Edge API.
# ---------------------------------------------------------------------------

LISTING_STATUS_VALUES = ("draft", "in_review", "published", "hiring", "paused", "closed", "cancelled", "expired")


class ProjectCategory(Base):
    """Work category with its workflow template (inputs, stages, acceptance)."""
    __tablename__ = "project_categories"
    slug: Mapped[str] = mapped_column(String(60), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(String(400), nullable=False, default="", server_default="")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=100, server_default="100")
    template_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}", server_default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now, server_default=func.now(), nullable=False)


class ProjectListing(Base):
    """A client organisation's native project and its lifecycle state."""
    __tablename__ = "project_listings"
    __table_args__ = (
        CheckConstraint("status IN ('draft', 'in_review', 'published', 'hiring', 'paused', 'closed', 'cancelled', 'expired')", name="ck_project_listings_status"),
        CheckConstraint("visibility IN ('public', 'invite_only', 'private')", name="ck_project_listings_visibility"),
        CheckConstraint("moderation_status IN ('not_screened', 'passed', 'flagged', 'approved', 'rejected')", name="ck_project_listings_moderation"),
        Index("ix_project_listings_org_created", "organization_id", "created_at"),
        Index("ix_project_listings_status_published", "status", "published_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    category_slug: Mapped[str] = mapped_column(ForeignKey("project_categories.slug"), index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft", server_default="draft")
    visibility: Mapped[str] = mapped_column(String(20), nullable=False, default="public", server_default="public")
    moderation_status: Mapped[str] = mapped_column(String(20), nullable=False, default="not_screened", server_default="not_screened")
    moderation_notes: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    current_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closes_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now, server_default=func.now(), nullable=False)


class ProjectListingVersion(Base):
    """Immutable snapshot of a listing's brief. Money in integer minor units."""
    __tablename__ = "project_listing_versions"
    __table_args__ = (
        UniqueConstraint("listing_id", "version", name="uq_listing_version"),
        CheckConstraint("budget_model IN ('fixed', 'hourly')", name="ck_listing_versions_budget_model"),
        CheckConstraint("budget_min_minor IS NULL OR budget_min_minor >= 0", name="ck_listing_versions_budget_min"),
        CheckConstraint("budget_max_minor IS NULL OR budget_min_minor IS NULL OR budget_max_minor >= budget_min_minor", name="ck_listing_versions_budget_range"),
        CheckConstraint("confidentiality IN ('standard', 'confidential')", name="ck_listing_versions_confidentiality"),
        CheckConstraint("experience_level IN ('any', 'entry', 'intermediate', 'expert')", name="ck_listing_versions_experience"),
        CheckConstraint("revision_rounds >= 0 AND revision_rounds <= 10", name="ck_listing_versions_revisions"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    listing_id: Mapped[str] = mapped_column(ForeignKey("project_listings.id", ondelete="CASCADE"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    category_slug: Mapped[str] = mapped_column(String(60), nullable=False)
    outcome: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    deliverables_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]", server_default="[]")
    skills_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]", server_default="[]")
    experience_level: Mapped[str] = mapped_column(String(20), nullable=False, default="any", server_default="any")
    budget_model: Mapped[str] = mapped_column(String(20), nullable=False, default="fixed", server_default="fixed")
    budget_min_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    budget_max_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR", server_default="INR")
    deadline: Mapped[object | None] = mapped_column(Date, nullable=True)
    milestones_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]", server_default="[]")
    acceptance_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]", server_default="[]")
    revision_rounds: Mapped[int] = mapped_column(Integer, nullable=False, default=2, server_default="2")
    languages_json: Mapped[str] = mapped_column(Text, nullable=False, default='["en"]', server_default='["en"]')
    timezone: Mapped[str] = mapped_column(String(60), nullable=False, default="", server_default="")
    confidentiality: Mapped[str] = mapped_column(String(20), nullable=False, default="standard", server_default="standard")
    ownership_notes: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    assumptions_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]", server_default="[]")
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class ListingInvitation(Base):
    """A client's invitation for one freelancer to propose on a listing (migration 0052)."""
    __tablename__ = "listing_invitations"
    __table_args__ = (
        UniqueConstraint("listing_id", "freelancer_user_id", name="uq_listing_invitation"),
        CheckConstraint("status IN ('pending', 'accepted', 'declined', 'withdrawn')", name="ck_listing_invitations_status"),
        Index("ix_listing_invitations_freelancer", "freelancer_user_id", "created_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    listing_id: Mapped[str] = mapped_column(ForeignKey("project_listings.id", ondelete="CASCADE"), nullable=False)
    freelancer_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    invited_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    message: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    match_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", server_default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SavedFreelancer(Base):
    """A freelancer an organisation saved for later (migration 0052)."""
    __tablename__ = "saved_freelancers"
    __table_args__ = (UniqueConstraint("organization_id", "freelancer_user_id", name="uq_saved_freelancer"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    freelancer_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    saved_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    note: Mapped[str] = mapped_column(String(300), nullable=False, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class ListingProposal(Base):
    """A freelancer's proposal on a native listing (migration 0053). Price in minor units, set by the freelancer."""
    __tablename__ = "listing_proposals"
    __table_args__ = (
        UniqueConstraint("listing_id", "freelancer_user_id", name="uq_listing_proposal"),
        CheckConstraint("status IN ('submitted', 'shortlisted', 'declined', 'withdrawn', 'offered', 'hired')", name="ck_listing_proposals_status"),
        CheckConstraint("price_minor > 0", name="ck_listing_proposals_price"),
        CheckConstraint("budget_model IN ('fixed', 'hourly')", name="ck_listing_proposals_model"),
        CheckConstraint("estimated_days IS NULL OR (estimated_days >= 1 AND estimated_days <= 730)", name="ck_listing_proposals_days"),
        Index("ix_listing_proposals_listing", "listing_id", "created_at"),
        Index("ix_listing_proposals_freelancer", "freelancer_user_id", "created_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    listing_id: Mapped[str] = mapped_column(ForeignKey("project_listings.id", ondelete="CASCADE"), nullable=False)
    freelancer_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    invitation_id: Mapped[str | None] = mapped_column(ForeignKey("listing_invitations.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="submitted", server_default="submitted")
    cover_letter: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    price_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR", server_default="INR")
    budget_model: Mapped[str] = mapped_column(String(20), nullable=False, default="fixed", server_default="fixed")
    estimated_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sections_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    current_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    revision_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revision_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ListingProposalVersion(Base):
    """One immutable version of a native proposal (migration 0067, Proposal Studio)."""
    __tablename__ = "listing_proposal_versions"
    __table_args__ = (
        UniqueConstraint("proposal_id", "version", name="uq_listing_proposal_version"),
        CheckConstraint("version >= 1", name="ck_listing_proposal_versions_version"),
        CheckConstraint("price_minor > 0", name="ck_listing_proposal_versions_price"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    proposal_id: Mapped[str] = mapped_column(ForeignKey("listing_proposals.id", ondelete="CASCADE"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    cover_letter: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    price_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    estimated_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sections_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class ProposalVersion(Base):
    """One text of an external proposal (migration 0069): model draft, safe template or edit."""
    __tablename__ = "proposal_versions"
    __table_args__ = (
        UniqueConstraint("proposal_id", "version", name="uq_proposal_version"),
        CheckConstraint("source IN ('model', 'safe_template', 'edited', 'legacy')", name="ck_proposal_versions_source"),
        CheckConstraint("version >= 1", name="ck_proposal_versions_version"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    proposal_id: Mapped[str] = mapped_column(ForeignKey("proposals.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    proposed_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="INR", server_default="INR")
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="edited", server_default="edited")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class OpportunityEvent(Base):
    """History of an external opportunity (migration 0069): status changes, submissions, follow-ups, interviews, notes."""
    __tablename__ = "opportunity_events"
    __table_args__ = (
        CheckConstraint("kind IN ('status', 'submission', 'follow_up', 'interview', 'note')", name="ck_opportunity_events_kind"),
        Index("ix_opportunity_events_opportunity", "opportunity_id", "created_at"),
        Index("ix_opportunity_events_due", "user_id", "due_date"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    opportunity_id: Mapped[str] = mapped_column(ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(40), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(40), nullable=True)
    note: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    application_id: Mapped[str | None] = mapped_column(ForeignKey("applications.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class ProposalMessage(Base):
    """Pre-contract discussion about a native proposal (migration 0070)."""
    __tablename__ = "proposal_messages"
    __table_args__ = (
        CheckConstraint("sender_party IN ('client', 'freelancer')", name="ck_proposal_messages_party"),
        Index("ix_proposal_messages_proposal", "proposal_id", "created_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    proposal_id: Mapped[str] = mapped_column(ForeignKey("listing_proposals.id", ondelete="CASCADE"), nullable=False)
    sender_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    sender_party: Mapped[str] = mapped_column(String(20), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class ProposalInterview(Base):
    """Interview slot on a native proposal (migration 0070)."""
    __tablename__ = "proposal_interviews"
    __table_args__ = (
        CheckConstraint("proposed_party IN ('client', 'freelancer')", name="ck_proposal_interviews_party"),
        CheckConstraint("mode IN ('video', 'phone', 'chat')", name="ck_proposal_interviews_mode"),
        CheckConstraint("status IN ('proposed', 'accepted', 'declined', 'cancelled', 'completed')", name="ck_proposal_interviews_status"),
        CheckConstraint("duration_minutes BETWEEN 15 AND 180", name="ck_proposal_interviews_duration"),
        Index("ix_proposal_interviews_proposal", "proposal_id", "starts_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    proposal_id: Mapped[str] = mapped_column(ForeignKey("listing_proposals.id", ondelete="CASCADE"), nullable=False)
    proposed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    proposed_party: Mapped[str] = mapped_column(String(20), nullable=False)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=30, server_default="30")
    mode: Mapped[str] = mapped_column(String(20), nullable=False, default="video", server_default="video")
    meeting_link: Mapped[str] = mapped_column(String(500), nullable=False, default="", server_default="")
    agenda: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="proposed", server_default="proposed")
    responded_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    outcome_note: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class SavedListing(Base):
    """A freelancer's saved native project (migration 0068)."""
    __tablename__ = "saved_listings"
    __table_args__ = (UniqueConstraint("user_id", "listing_id", name="uq_saved_listing"), Index("ix_saved_listings_user", "user_id", "created_at"))
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    listing_id: Mapped[str] = mapped_column(ForeignKey("project_listings.id", ondelete="CASCADE"), nullable=False)
    note: Mapped[str] = mapped_column(String(300), nullable=False, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class SupportTicket(Base):
    """A Contact-page or in-app support message handled by staff (migration 0068)."""
    __tablename__ = "support_tickets"
    __table_args__ = (
        CheckConstraint("topic IN ('account', 'payments', 'project', 'safety', 'business', 'other')", name="ck_support_tickets_topic"),
        CheckConstraint("status IN ('open', 'resolved')", name="ck_support_tickets_status"),
        Index("ix_support_tickets_status", "status", "created_at"),
        Index("ix_support_tickets_user", "user_id", "created_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, default="", server_default="")
    name: Mapped[str] = mapped_column(String(120), nullable=False, default="", server_default="")
    topic: Mapped[str] = mapped_column(String(30), nullable=False)
    subject: Mapped[str] = mapped_column(String(160), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open", server_default="open")
    resolution_note: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    resolved_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class Contract(Base):
    """An offer/agreement between a client organisation and a freelancer (migration 0053)."""
    __tablename__ = "contracts"
    __table_args__ = (
        CheckConstraint("status IN ('offered', 'active', 'declined', 'withdrawn', 'completed', 'cancelled')", name="ck_contracts_status"),
        Index("ix_contracts_org", "organization_id", "created_at"),
        Index("ix_contracts_freelancer", "freelancer_user_id", "created_at"),
        Index("uq_contracts_open_per_proposal", "proposal_id", unique=True,
              postgresql_where=sql_text("status IN ('offered', 'active')"), sqlite_where=sql_text("status IN ('offered', 'active')")),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    listing_id: Mapped[str] = mapped_column(ForeignKey("project_listings.id", ondelete="RESTRICT"), nullable=False)
    proposal_id: Mapped[str] = mapped_column(ForeignKey("listing_proposals.id", ondelete="RESTRICT"), nullable=False)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=False)
    freelancer_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="offered", server_default="offered")
    current_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    agreed_version: Mapped[int | None] = mapped_column(Integer, nullable=True)


class ContractVersion(Base):
    """Immutable contract terms with each party's acceptance (migration 0053)."""
    __tablename__ = "contract_versions"
    __table_args__ = (
        UniqueConstraint("contract_id", "version", name="uq_contract_version"),
        CheckConstraint("total_minor > 0", name="ck_contract_versions_total"),
        CheckConstraint("revision_rounds >= 0 AND revision_rounds <= 10", name="ck_contract_versions_revisions"),
        CheckConstraint("proposed_by IN ('client', 'freelancer')", name="ck_contract_versions_proposed_by"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    contract_id: Mapped[str] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    scope: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    deliverables_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]", server_default="[]")
    milestones_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]", server_default="[]")
    total_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR", server_default="INR")
    revision_rounds: Mapped[int] = mapped_column(Integer, nullable=False, default=2, server_default="2")
    acceptance_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]", server_default="[]")
    ownership_terms: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    proposed_by: Mapped[str] = mapped_column(String(20), nullable=False)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)
    client_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    client_accepted_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    freelancer_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ContractMessage(Base):
    """A message between the parties of a contract (migration 0054)."""
    __tablename__ = "contract_messages"
    __table_args__ = (
        CheckConstraint("sender_party IN ('client', 'freelancer')", name="ck_contract_messages_party"),
        Index("ix_contract_messages_contract", "contract_id", "created_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    contract_id: Mapped[str] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False)
    sender_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    sender_party: Mapped[str] = mapped_column(String(20), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class MilestoneSubmission(Base):
    """A delivery for one contract milestone and its review (migration 0054)."""
    __tablename__ = "milestone_submissions"
    __table_args__ = (
        CheckConstraint("status IN ('submitted', 'approved', 'revision_requested')", name="ck_milestone_submissions_status"),
        CheckConstraint("milestone_index >= 0 AND milestone_index < 20", name="ck_milestone_submissions_index"),
        Index("ix_milestone_submissions_contract", "contract_id", "milestone_index", "submitted_at"),
        Index("uq_milestone_open_submission", "contract_id", "milestone_index", unique=True,
              postgresql_where=sql_text("status = 'submitted'"), sqlite_where=sql_text("status = 'submitted'")),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    contract_id: Mapped[str] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False)
    milestone_index: Mapped[int] = mapped_column(Integer, nullable=False)
    contract_version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="submitted", server_default="submitted")
    note: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    links_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]", server_default="[]")
    submitted_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)
    reviewed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")


class ContractEvent(Base):
    """Append-only contract activity log (migration 0054)."""
    __tablename__ = "contract_events"
    __table_args__ = (
        CheckConstraint("actor_party IN ('client', 'freelancer', 'system')", name="ck_contract_events_party"),
        Index("ix_contract_events_contract", "contract_id", "created_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    contract_id: Mapped[str] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False)
    actor_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    actor_party: Mapped[str] = mapped_column(String(20), nullable=False)
    event_type: Mapped[str] = mapped_column(String(60), nullable=False)
    details_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}", server_default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class ContractReview(Base):
    """One review per party per completed contract (migration 0055)."""
    __tablename__ = "contract_reviews"
    __table_args__ = (
        UniqueConstraint("contract_id", "reviewer_party", name="uq_contract_review_party"),
        CheckConstraint("reviewer_party IN ('client', 'freelancer')", name="ck_contract_reviews_party"),
        CheckConstraint("rating >= 1 AND rating <= 5", name="ck_contract_reviews_rating"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    contract_id: Mapped[str] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False)
    reviewer_party: Mapped[str] = mapped_column(String(20), nullable=False)
    reviewer_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    comment: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class LedgerAccount(Base):
    """Chart-of-accounts entry (migration 0056)."""
    __tablename__ = "ledger_accounts"
    __table_args__ = (
        UniqueConstraint("code", "currency", name="uq_ledger_account_code"),
        CheckConstraint("kind IN ('asset', 'liability', 'revenue', 'expense', 'equity')", name="ck_ledger_accounts_kind"),
        CheckConstraint("owner_type IN ('platform', 'organization', 'user', 'provider')", name="ck_ledger_accounts_owner"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    code: Mapped[str] = mapped_column(String(160), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    owner_type: Mapped[str] = mapped_column(String(20), nullable=False, default="platform", server_default="platform")
    owner_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class LedgerEntry(Base):
    """Append-only journal entry (migration 0056). Balanced and immutable in PostgreSQL via triggers."""
    __tablename__ = "ledger_entries"
    __table_args__ = (
        CheckConstraint("mode IN ('sandbox', 'live')", name="ck_ledger_entries_mode"),
        Index("ix_ledger_entries_contract", "contract_id", "created_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    idempotency_key: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    entry_type: Mapped[str] = mapped_column(String(60), nullable=False)
    description: Mapped[str] = mapped_column(String(300), nullable=False, default="", server_default="")
    mode: Mapped[str] = mapped_column(String(10), nullable=False)
    contract_id: Mapped[str | None] = mapped_column(ForeignKey("contracts.id", ondelete="RESTRICT"), nullable=True)
    reverses_entry_id: Mapped[str | None] = mapped_column(ForeignKey("ledger_entries.id", ondelete="RESTRICT"), nullable=True)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class LedgerLine(Base):
    """Debit or credit line of a journal entry, integer minor units (migration 0056)."""
    __tablename__ = "ledger_lines"
    __table_args__ = (
        CheckConstraint("direction IN ('debit', 'credit')", name="ck_ledger_lines_direction"),
        CheckConstraint("amount_minor > 0", name="ck_ledger_lines_amount"),
        Index("ix_ledger_lines_entry", "entry_id"),
        Index("ix_ledger_lines_account", "account_id"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    entry_id: Mapped[str] = mapped_column(ForeignKey("ledger_entries.id", ondelete="RESTRICT"), nullable=False)
    account_id: Mapped[str] = mapped_column(ForeignKey("ledger_accounts.id", ondelete="RESTRICT"), nullable=False)
    direction: Mapped[str] = mapped_column(String(6), nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)


class FeeSchedule(Base):
    """Configurable platform fees in basis points (migration 0056). Not seeded: D-5."""
    __tablename__ = "fee_schedules"
    __table_args__ = (
        CheckConstraint("client_fee_bps >= 0 AND client_fee_bps <= 3000", name="ck_fee_schedules_client_bps"),
        CheckConstraint("freelancer_fee_bps >= 0 AND freelancer_fee_bps <= 3000", name="ck_fee_schedules_freelancer_bps"),
        CheckConstraint("min_fee_minor >= 0", name="ck_fee_schedules_min"),
        CheckConstraint("status IN ('draft', 'approved', 'retired')", name="ck_fee_schedules_status"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    client_fee_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    freelancer_fee_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    min_fee_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft", server_default="draft")
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class Plan(Base):
    """Plan catalogue with AI limits (migration 0057). Only 'free' is seeded; prices are D-14."""
    __tablename__ = "plans"
    __table_args__ = (
        CheckConstraint("price_minor IS NULL OR price_minor >= 0", name="ck_plans_price"),
        CheckConstraint("ai_daily_limit >= 0 AND ai_monthly_limit >= 0", name="ck_plans_limits"),
        CheckConstraint("billing_interval IN ('month', 'year')", name="ck_plans_interval"),
        CheckConstraint("status IN ('draft', 'active', 'retired')", name="ck_plans_status"),
    )
    code: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    description: Mapped[str] = mapped_column(String(300), nullable=False, default="", server_default="")
    price_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR", server_default="INR")
    billing_interval: Mapped[str] = mapped_column(String(10), nullable=False, default="month", server_default="month")
    ai_daily_limit: Mapped[int] = mapped_column(Integer, nullable=False)
    ai_monthly_limit: Mapped[int] = mapped_column(Integer, nullable=False)
    features_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]", server_default="[]")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft", server_default="draft")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=100, server_default="100")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class UserPlan(Base):
    """A user's current plan (migration 0057). No row means the free plan."""
    __tablename__ = "user_plans"
    __table_args__ = (CheckConstraint("source IN ('admin', 'purchase', 'promotion')", name="ck_user_plans_source"),)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    plan_code: Mapped[str] = mapped_column(ForeignKey("plans.code", ondelete="RESTRICT"), nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="admin", server_default="admin")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    granted_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class AICreditLedger(Base):
    """Signed AI credit movements (migration 0057); balance = sum(delta)."""
    __tablename__ = "ai_credit_ledger"
    __table_args__ = (
        UniqueConstraint("reason", "ref", name="uq_ai_credit_ledger_ref"),
        CheckConstraint("delta <> 0", name="ck_ai_credit_ledger_delta"),
        CheckConstraint("reason IN ('grant', 'ai_call', 'adjustment', 'purchase', 'expiry')", name="ck_ai_credit_ledger_reason"),
        Index("ix_ai_credit_ledger_user", "user_id", "created_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    delta: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String(20), nullable=False)
    ref: Mapped[str] = mapped_column(String(100), nullable=False)
    note: Mapped[str] = mapped_column(String(300), nullable=False, default="", server_default="")
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class AgentDefinition(Base):
    """Governed agent registry entry (migration 0058): Master Plan catalogue with honest build status."""
    __tablename__ = "agent_definitions"
    __table_args__ = (
        CheckConstraint("side IN ('freelancer', 'client', 'platform')", name="ck_agent_definitions_side"),
        CheckConstraint("autonomy_ceiling IN ('A0', 'A1', 'A2', 'A3', 'A4')", name="ck_agent_definitions_ceiling"),
        CheckConstraint("status IN ('live', 'partial', 'planned', 'blocked')", name="ck_agent_definitions_status"),
    )
    code: Mapped[str] = mapped_column(String(4), primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    side: Mapped[str] = mapped_column(String(20), nullable=False)
    purpose: Mapped[str] = mapped_column(String(400), nullable=False)
    autonomy_ceiling: Mapped[str] = mapped_column(String(2), nullable=False)
    human_gate: Mapped[str] = mapped_column(String(200), nullable=False)
    tools_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]", server_default="[]")
    runtime_names_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]", server_default="[]")
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    updated_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class Report(Base):
    """A user's report about content or another user (migration 0060)."""
    __tablename__ = "reports"
    __table_args__ = (
        CheckConstraint("target_type IN ('listing', 'user', 'proposal', 'contract_message', 'review')", name="ck_reports_target"),
        CheckConstraint("reason IN ('spam', 'scam', 'off_platform', 'abuse', 'prohibited', 'fake', 'other')", name="ck_reports_reason"),
        CheckConstraint("status IN ('open', 'actioned', 'dismissed')", name="ck_reports_status"),
        Index("ix_reports_status_created", "status", "created_at"),
        Index("uq_reports_open_per_reporter", "reporter_user_id", "target_type", "target_id", unique=True,
              postgresql_where=sql_text("status = 'open'"), sqlite_where=sql_text("status = 'open'")),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    reporter_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    target_type: Mapped[str] = mapped_column(String(30), nullable=False)
    target_id: Mapped[str] = mapped_column(String(64), nullable=False)
    reason: Mapped[str] = mapped_column(String(30), nullable=False)
    details: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open", server_default="open")
    resolution_note: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    resolved_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class ModerationAction(Base):
    """Append-only staff decision log (migration 0060; UPDATE/DELETE refused in PostgreSQL)."""
    __tablename__ = "moderation_actions"
    __table_args__ = (Index("ix_moderation_actions_target", "target_type", "target_id", "created_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    actor_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    target_type: Mapped[str] = mapped_column(String(30), nullable=False)
    target_id: Mapped[str] = mapped_column(String(80), nullable=False)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    note: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class PaymentIntent(Base):
    """Funding of one contract milestone, fees locked at creation (migration 0061)."""
    __tablename__ = "payment_intents"
    __table_args__ = (
        CheckConstraint("mode IN ('sandbox', 'live')", name="ck_payment_intents_mode"),
        CheckConstraint("status IN ('created', 'funded', 'released', 'refunded', 'failed', 'cancelled')", name="ck_payment_intents_status"),
        CheckConstraint("amount_minor > 0 AND client_fee_minor >= 0 AND freelancer_fee_minor >= 0 AND freelancer_fee_minor <= amount_minor", name="ck_payment_intents_amounts"),
        CheckConstraint("total_minor = amount_minor + client_fee_minor", name="ck_payment_intents_total"),
        CheckConstraint("milestone_index >= 0 AND milestone_index < 20", name="ck_payment_intents_index"),
        Index("ix_payment_intents_contract", "contract_id", "milestone_index"),
        Index("uq_payment_intents_open_milestone", "contract_id", "milestone_index", unique=True,
              postgresql_where=sql_text("status IN ('created', 'funded')"), sqlite_where=sql_text("status IN ('created', 'funded')")),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    contract_id: Mapped[str] = mapped_column(ForeignKey("contracts.id", ondelete="RESTRICT"), nullable=False)
    milestone_index: Mapped[int] = mapped_column(Integer, nullable=False)
    contract_version: Mapped[int] = mapped_column(Integer, nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    client_fee_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    freelancer_fee_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    total_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    fee_schedule_id: Mapped[str] = mapped_column(ForeignKey("fee_schedules.id", ondelete="RESTRICT"), nullable=False)
    provider: Mapped[str] = mapped_column(String(30), nullable=False)
    provider_ref: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    mode: Mapped[str] = mapped_column(String(10), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="created", server_default="created")
    idempotency_key: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)
    funded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PaymentEvent(Base):
    """Raw payment-provider event, unique per provider+event id (migration 0061)."""
    __tablename__ = "payment_events"
    __table_args__ = (
        UniqueConstraint("provider", "event_id", name="uq_payment_events_provider_event"),
        CheckConstraint("source IN ('webhook', 'sandbox')", name="ck_payment_events_source"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    provider: Mapped[str] = mapped_column(String(30), nullable=False)
    event_id: Mapped[str] = mapped_column(String(120), nullable=False)
    event_type: Mapped[str] = mapped_column(String(60), nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    signature_valid: Mapped[bool] = mapped_column(Boolean, nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class Payout(Base):
    """Freelancer withdrawal from released funds (migration 0061)."""
    __tablename__ = "payouts"
    __table_args__ = (
        CheckConstraint("mode IN ('sandbox', 'live')", name="ck_payouts_mode"),
        CheckConstraint("status IN ('requested', 'paid', 'failed')", name="ck_payouts_status"),
        CheckConstraint("amount_minor > 0", name="ck_payouts_amount"),
        Index("ix_payouts_user", "user_id", "created_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    provider: Mapped[str] = mapped_column(String(30), nullable=False)
    provider_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)
    mode: Mapped[str] = mapped_column(String(10), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="requested", server_default="requested")
    idempotency_key: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class BillingInvoice(Base):
    """Client invoice for a funded milestone (migration 0061). Sandbox ones are test documents."""
    __tablename__ = "billing_invoices"
    __table_args__ = (
        CheckConstraint("mode IN ('sandbox', 'live')", name="ck_billing_invoices_mode"),
        CheckConstraint("status IN ('paid', 'refunded')", name="ck_billing_invoices_status"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    number: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    mode: Mapped[str] = mapped_column(String(10), nullable=False)
    contract_id: Mapped[str] = mapped_column(ForeignKey("contracts.id", ondelete="RESTRICT"), nullable=False)
    payment_intent_id: Mapped[str] = mapped_column(ForeignKey("payment_intents.id", ondelete="RESTRICT"), nullable=False, unique=True)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=False)
    milestone_title: Mapped[str] = mapped_column(String(160), nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    client_fee_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    total_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="paid", server_default="paid")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class ContractCancellation(Base):
    """A party's request to cancel an active contract (migration 0061)."""
    __tablename__ = "contract_cancellations"
    __table_args__ = (
        CheckConstraint("requested_by_party IN ('client', 'freelancer')", name="ck_contract_cancellations_party"),
        CheckConstraint("status IN ('open', 'accepted', 'declined', 'withdrawn')", name="ck_contract_cancellations_status"),
        Index("uq_contract_cancellations_open", "contract_id", unique=True,
              postgresql_where=sql_text("status = 'open'"), sqlite_where=sql_text("status = 'open'")),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    contract_id: Mapped[str] = mapped_column(ForeignKey("contracts.id", ondelete="RESTRICT"), nullable=False)
    requested_by_party: Mapped[str] = mapped_column(String(20), nullable=False)
    requested_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open", server_default="open")
    responded_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Dispute(Base):
    """A party's dispute on a contract and the staff resolution (migration 0063)."""
    __tablename__ = "disputes"
    __table_args__ = (
        CheckConstraint("opened_by_party IN ('client', 'freelancer')", name="ck_disputes_party"),
        CheckConstraint("reason IN ('quality', 'non_delivery', 'scope', 'payment', 'communication', 'other')", name="ck_disputes_reason"),
        CheckConstraint("status IN ('open', 'resolved', 'withdrawn')", name="ck_disputes_status"),
        CheckConstraint("resolution IS NULL OR resolution IN ('release_funded', 'refund_funded', 'no_action')", name="ck_disputes_resolution"),
        Index("ix_disputes_status_created", "status", "created_at"),
        Index("uq_disputes_open_per_contract", "contract_id", unique=True,
              postgresql_where=sql_text("status = 'open'"), sqlite_where=sql_text("status = 'open'")),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    contract_id: Mapped[str] = mapped_column(ForeignKey("contracts.id", ondelete="RESTRICT"), nullable=False)
    opened_by_party: Mapped[str] = mapped_column(String(20), nullable=False)
    opened_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reason: Mapped[str] = mapped_column(String(30), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    desired_outcome: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open", server_default="open")
    resolution: Mapped[str | None] = mapped_column(String(30), nullable=True)
    resolution_note: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    resolved_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class DisputeStatement(Base):
    """A party's statement in a dispute (migration 0063)."""
    __tablename__ = "dispute_statements"
    __table_args__ = (
        CheckConstraint("party IN ('client', 'freelancer')", name="ck_dispute_statements_party"),
        Index("ix_dispute_statements_dispute", "dispute_id", "created_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    dispute_id: Mapped[str] = mapped_column(ForeignKey("disputes.id", ondelete="CASCADE"), nullable=False)
    party: Mapped[str] = mapped_column(String(20), nullable=False)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class AccountSuspension(Base):
    """Staff suspension of an account with one appeal (migration 0063)."""
    __tablename__ = "account_suspensions"
    __table_args__ = (
        CheckConstraint("status IN ('active', 'lifted')", name="ck_account_suspensions_status"),
        CheckConstraint("appeal_status IN ('none', 'pending', 'upheld', 'overturned')", name="ck_account_suspensions_appeal"),
        Index("uq_account_suspensions_active", "user_id", unique=True,
              postgresql_where=sql_text("status = 'active'"), sqlite_where=sql_text("status = 'active'")),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", server_default="active")
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)
    lifted_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    lifted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lift_note: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    appeal_text: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    appeal_status: Mapped[str] = mapped_column(String(20), nullable=False, default="none", server_default="none")
    appeal_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class OrganizationInvitation(Base):
    """Team invitation to an organisation; only the token hash is stored (migration 0064)."""
    __tablename__ = "organization_invitations"
    __table_args__ = (
        CheckConstraint("role IN ('admin', 'member')", name="ck_org_invitations_role"),
        CheckConstraint("status IN ('pending', 'accepted', 'declined', 'revoked')", name="ck_org_invitations_status"),
        UniqueConstraint("token_hash", name="uq_org_invitations_token"),
        Index("ix_org_invitations_org", "organization_id", "status"),
        Index("ix_org_invitations_email", "email", "status"),
        Index("uq_org_invitations_pending", "organization_id", "email", unique=True,
              postgresql_where=sql_text("status = 'pending'"), sqlite_where=sql_text("status = 'pending'")),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="member", server_default="member")
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", server_default="pending")
    invited_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    accepted_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)


class ContractFile(Base):
    """File attached to a contract; bytes are in R2, metadata here (migration 0065)."""
    __tablename__ = "contract_files"
    __table_args__ = (
        CheckConstraint("party IN ('client', 'freelancer')", name="ck_contract_files_party"),
        CheckConstraint("status IN ('ready', 'deleted')", name="ck_contract_files_status"),
        CheckConstraint("size_bytes > 0", name="ck_contract_files_size"),
        UniqueConstraint("r2_key", name="uq_contract_files_key"),
        Index("ix_contract_files_contract", "contract_id", "created_at"),
        Index("ix_contract_files_submission", "submission_id"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    contract_id: Mapped[str] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False)
    uploaded_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    party: Mapped[str] = mapped_column(String(20), nullable=False)
    submission_id: Mapped[str | None] = mapped_column(ForeignKey("milestone_submissions.id", ondelete="SET NULL"), nullable=True)
    r2_key: Mapped[str] = mapped_column(String(200), nullable=False)
    filename: Mapped[str] = mapped_column(String(160), nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="ready", server_default="ready")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, server_default=func.now(), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


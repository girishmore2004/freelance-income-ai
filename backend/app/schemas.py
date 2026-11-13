from datetime import datetime
from pydantic import BaseModel, EmailStr, Field, ConfigDict, field_validator
from typing import Optional
class AuthIn(BaseModel): email: EmailStr; password: str = Field(min_length=10, max_length=128)
class RegisterIn(BaseModel): email: EmailStr; password: str = Field(min_length=12, max_length=128)
class TokenOut(BaseModel): access_token: str; token_type: str = "bearer"
class EmailOnlyIn(BaseModel): email: EmailStr
class VerifyEmailIn(BaseModel): token: str = Field(min_length=32, max_length=256)
class PasswordResetIn(BaseModel): token: str = Field(min_length=32, max_length=256); new_password: str = Field(min_length=12, max_length=128)
class PasswordChangeIn(BaseModel): current_password: str = Field(min_length=1, max_length=128); new_password: str = Field(min_length=12, max_length=128)
class ProfileIn(BaseModel):
    full_name: str = ""
    headline: str = ""
    bio: str = ""
    skills: list[str] = Field(default_factory=list)
    services: list[str] = Field(default_factory=list)
    portfolio_links: list[str] = Field(default_factory=list)
    minimum_budget: float = Field(default=5000, ge=0)
    currency: str = "INR"
    weekly_hours: int = Field(default=10, ge=1, le=80)
    hourly_rate: float = Field(default=0, ge=0)
    timezone: str = "Asia/Kolkata"
    preferred_work_types: list[str] = Field(default_factory=lambda: ["fixed", "hourly"])
    preferred_industries: list[str] = Field(default_factory=list)
    dealbreakers: list[str] = Field(default_factory=list)
class OpportunityIn(BaseModel):
    source: str = "manual"
    external_id: str = ""
    title: str = Field(min_length=3, max_length=300)
    client_name: str = "Unknown"
    description: str = Field(min_length=10)
    source_url: str = ""
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    currency: str = "INR"
    required_skills: list[str] = Field(default_factory=list)
    deadline: str = ""
    job_type: str = "unknown"
    industry: str = ""
    estimated_hours: Optional[float] = Field(default=None, gt=0)
    competition_level: str = "unknown"
    client_rating: Optional[float] = Field(default=None, ge=0, le=5)
    client_reviews: Optional[int] = Field(default=None, ge=0)
    client_payment_verified: Optional[bool] = None
class ProposalIn(BaseModel): opportunity_id: str; proposed_price: Optional[float] = None; currency: str = "INR"
class ProposalEdit(BaseModel): content: str = Field(min_length=30); proposed_price: Optional[float] = None
class DecisionIn(BaseModel): decision: str; note: str = ""
class ProjectIn(BaseModel): title: str; client_name: str = ""; description: str = ""; budget: float = 0; currency: str = "INR"; due_date: str = ""; status: str = "active"
class InvoiceIn(BaseModel): project_id: Optional[str] = None; invoice_number: str; amount: float = Field(gt=0); currency: str = "INR"; due_date: str = ""
class RSSIn(BaseModel): feed_url: str

class UpworkDiscoveryIn(BaseModel):
    search_term: str = Field(min_length=2, max_length=160)
    limit: int = Field(default=20, ge=1, le=50)
    cursor: Optional[str] = Field(default=None, max_length=1000)

class InvoiceStatusIn(BaseModel): status: str


class ClientCostEntryIn(BaseModel):
    project_id: Optional[str] = None
    category: str = Field(default="other", max_length=40)
    description: str = Field(min_length=2, max_length=300)
    amount: float = Field(gt=0)
    currency: str = Field(default="INR", min_length=3, max_length=8)
    cost_date: str = Field(min_length=10, max_length=10)
    evidence_reference: str = Field(default="", max_length=2000)


class InvoicePaymentEventIn(BaseModel):
    event_type: str
    amount: float = Field(default=0, ge=0)
    currency: str = Field(default="INR", min_length=3, max_length=8)
    reference: str = Field(default="", max_length=240)
    evidence_reference: str = Field(min_length=8, max_length=2000)
    note: str = Field(default="", max_length=4000)
    occurred_at: Optional[datetime] = None




class TaskIn(BaseModel):
    project_id: str
    title: str = Field(min_length=2, max_length=240)
    description: str = ""
    status: str = "todo"
    priority: str = "medium"
    due_date: str = ""
    estimated_hours: Optional[float] = Field(default=None, ge=0, le=10000)
    planned_start_date: str = ""
class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    due_date: Optional[str] = None
    estimated_hours: Optional[float] = Field(default=None, ge=0, le=10000)
    planned_start_date: Optional[str] = None
class MilestoneIn(BaseModel):
    project_id: str
    title: str = Field(min_length=2, max_length=240)
    description: str = ""
    amount: float = Field(default=0, ge=0)
    currency: str = "INR"
    due_date: str = ""
class MilestoneUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[float] = Field(default=None, ge=0)
    currency: Optional[str] = None
    due_date: Optional[str] = None
    status: Optional[str] = None
class ResearchIn(BaseModel):
    opportunity_id: Optional[str] = None
    client_name: str = Field(min_length=1, max_length=200)
    evidence_type: str = "user_note"
    claim: str = Field(min_length=3, max_length=5000)
    evidence_url: str = Field(default="", max_length=1200)
    confidence: str = "unverified"
class FeedbackIn(BaseModel):
    opportunity_id: Optional[str] = None
    outcome: str
    reason: str = ""
class N8NEventIn(BaseModel):
    event_type: str
    title: str
    message: str
    user_id: str


class SourceIn(BaseModel):
    name: str = Field(default="Opportunity source", min_length=2, max_length=160)
    source_type: str = Field(default="rss", pattern="^(rss|json_api)$")
    feed_url: str = Field(min_length=10, max_length=1200)
    enabled: bool = True


class BackgroundJobIn(BaseModel):
    job_type: str = "rss_discovery"


class ClientRiskAssessmentIn(BaseModel):
    opportunity_id: str


class WorkflowStartIn(BaseModel):
    opportunity_id: str
    proposed_price: Optional[float] = Field(default=None, ge=0)
    currency: Optional[str] = Field(default=None, min_length=3, max_length=8)


class TimeEntryIn(BaseModel):
    project_id: str
    task_id: Optional[str] = None
    work_date: str = Field(min_length=10, max_length=10)
    duration_minutes: int = Field(gt=0, le=1440)
    description: str = Field(default="", max_length=2000)
    billable: bool = True
    hourly_rate: float = Field(default=0, ge=0)
    currency: str = Field(default="INR", min_length=3, max_length=8)


class EmailIntakeIn(BaseModel):
    provider: str = Field(default="manual", min_length=2, max_length=40)
    external_id: str = Field(default="", max_length=255)
    thread_id: str = Field(default="", max_length=255)
    sender_name: str = Field(default="", max_length=200)
    sender_email: str = Field(default="", max_length=320)
    subject: str = Field(default="", max_length=500)
    body_text: str = Field(min_length=3, max_length=30000)
    opportunity_id: Optional[str] = None
    project_id: Optional[str] = None
    received_at: Optional[datetime] = None

class EmailDraftDecisionIn(BaseModel):
    decision: str = Field(pattern="^(approved|rejected)$")
    note: str = Field(default="", max_length=2000)

class FollowUpIn(BaseModel):
    email_id: Optional[str] = None
    project_id: Optional[str] = None
    title: str = Field(min_length=2, max_length=240)
    notes: str = Field(default="", max_length=3000)
    due_at: datetime

class EmailDraftEditIn(BaseModel):
    subject: str = Field(min_length=1, max_length=500)
    body_text: str = Field(min_length=3, max_length=30000)


class EmailProjectLinkIn(BaseModel):
    project_id: Optional[str] = None


class ClientIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    company: str = Field(default="", max_length=200)
    email: Optional[EmailStr] = None
    phone: str = Field(default="", max_length=40)
    website: str = Field(default="", max_length=1200)
    notes: str = Field(default="", max_length=10000)
    tags: list[str] = Field(default_factory=list)
    status: str = Field(default="active", pattern="^(active|inactive|prospect|archived)$")


class ClientUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    company: Optional[str] = Field(default=None, max_length=200)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(default=None, max_length=40)
    website: Optional[str] = Field(default=None, max_length=1200)
    notes: Optional[str] = Field(default=None, max_length=10000)
    tags: Optional[list[str]] = None
    status: Optional[str] = Field(default=None, pattern="^(active|inactive|prospect|archived)$")


class ProjectClientLinkIn(BaseModel):
    client_id: str


class ScopeChangeIn(BaseModel):
    title: str = Field(min_length=3, max_length=240)
    description: str = Field(min_length=10, max_length=10000)
    reason: str = Field(default="", max_length=5000)
    budget_delta: float = Field(default=0, ge=-100000000, le=100000000)
    currency: str = Field(default="INR", min_length=3, max_length=8)
    timeline_delta_days: int = Field(default=0, ge=-3650, le=3650)


class ScopeChangeDecisionIn(BaseModel):
    decision: str = Field(pattern="^(approved|rejected)$")
    request_hash: str = Field(min_length=64, max_length=64)
    client_accepted: bool = False
    note: str = Field(default="", max_length=3000)


class ClientContractIn(BaseModel):
    client_id: str
    project_id: Optional[str] = None
    title: str = Field(min_length=3, max_length=240)
    contract_type: str = Field(default="statement_of_work", pattern="^(statement_of_work|contract|change_order)$")
    content: str = Field(min_length=30, max_length=50000)
    currency: str = Field(default="INR", min_length=3, max_length=8)
    value: float = Field(default=0, ge=0)
    expires_on: str = Field(default="", max_length=10)

class ClientContractDecisionIn(BaseModel):
    decision: str = Field(pattern="^(sent|accepted|rejected|expired|archived)$")
    content_hash: str = Field(min_length=64, max_length=64)
    note: str = Field(default="", max_length=3000)
    client_acceptance_evidence: str = Field(default="", max_length=3000)


class ClientContractRevisionIn(BaseModel):
    title: str = Field(min_length=3, max_length=240)
    content: str = Field(min_length=30, max_length=50000)
    contract_type: str = Field(default="statement_of_work", pattern="^(statement_of_work|contract|change_order)$")
    currency: str = Field(default="INR", min_length=3, max_length=8)
    value: float = Field(default=0, ge=0)
    expires_on: str = Field(default="", max_length=10)
    change_note: str = Field(min_length=3, max_length=2000)


class ClientCommunicationIn(BaseModel):
    client_id: str
    project_id: Optional[str] = None
    channel: str = Field(default="note", pattern="^(note|email|call|meeting|message|other)$")
    direction: str = Field(default="internal", pattern="^(inbound|outbound|internal)$")
    subject: str = Field(default="", max_length=300)
    body: str = Field(min_length=2, max_length=20000)
    occurred_at: Optional[datetime] = None



class OpportunityReviewIn(BaseModel):
    decision: str = Field(default="saved", min_length=3, max_length=30)
    notes: str = Field(default="", max_length=4000)
    next_action_date: str = Field(default="", max_length=10)


class SavedMarketplaceSearchIn(BaseModel):
    search_term: str = Field(min_length=2, max_length=160)
    result_limit: int = Field(default=20, ge=1, le=50)
    interval_hours: int = Field(default=24, ge=6, le=24)
    is_active: bool = True

    @field_validator("search_term")
    @classmethod
    def normalize_search_term(cls, value):
        value = value.strip()
        if len(value) < 2:
            raise ValueError("search_term must contain at least two non-space characters")
        return value

    @field_validator("interval_hours")
    @classmethod
    def validate_interval(cls, value):
        if value not in (6, 12, 24):
            raise ValueError("interval_hours must be 6, 12 or 24")
        return value


class SavedMarketplaceSearchUpdate(BaseModel):
    search_term: str | None = Field(default=None, min_length=2, max_length=160)
    result_limit: int | None = Field(default=None, ge=1, le=50)
    interval_hours: int | None = Field(default=None, ge=6, le=24)
    is_active: bool | None = None


    @field_validator("search_term")
    @classmethod
    def normalize_update_search_term(cls, value):
        if value is None:
            return value
        value = value.strip()
        if len(value) < 2:
            raise ValueError("search_term must contain at least two non-space characters")
        return value

    @field_validator("interval_hours")
    @classmethod
    def validate_update_interval(cls, value):
        if value is not None and value not in (6, 12, 24):
            raise ValueError("interval_hours must be 6, 12 or 24")
        return value


class MFACodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=32)


class MFALoginIn(BaseModel):
    challenge_token: str = Field(min_length=32, max_length=2048)
    code: str = Field(min_length=6, max_length=32)


class MFADisableIn(BaseModel):
    password: str = Field(min_length=1, max_length=128)
    code: str = Field(min_length=6, max_length=32)


class MFASetupIn(BaseModel):
    password: str = Field(min_length=1, max_length=128)

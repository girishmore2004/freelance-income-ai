"""Tenant-boundary regression tests for durable agent workflow records."""
import uuid
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from app.database import Base
from app.models import User, AgentWorkflowRun, AgentWorkflowCheckpoint


def make_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine, tables=[
        User.__table__, AgentWorkflowRun.__table__, AgentWorkflowCheckpoint.__table__
    ])
    return sessionmaker(bind=engine)()


def test_workflow_lookup_is_scoped_to_owner():
    db = make_db()
    owner = User(email="owner37@example.test", password_hash="x")
    other = User(email="other37@example.test", password_hash="x")
    db.add_all([owner, other]); db.commit()
    run = AgentWorkflowRun(user_id=owner.id, workflow_type="business_review",
                           idempotency_key=str(uuid.uuid4()), status="completed")
    db.add(run); db.commit()
    visible = db.scalar(select(AgentWorkflowRun).where(
        AgentWorkflowRun.id == run.id, AgentWorkflowRun.user_id == owner.id
    ))
    hidden = db.scalar(select(AgentWorkflowRun).where(
        AgentWorkflowRun.id == run.id, AgentWorkflowRun.user_id == other.id
    ))
    assert visible is not None
    assert hidden is None


def test_checkpoint_read_is_reached_only_after_owner_scoped_parent():
    db = make_db()
    owner = User(email="checkpoint-owner37@example.test", password_hash="x")
    other = User(email="checkpoint-other37@example.test", password_hash="x")
    db.add_all([owner, other]); db.commit()
    run = AgentWorkflowRun(user_id=owner.id, workflow_type="finance_review",
                           idempotency_key=str(uuid.uuid4()), status="completed")
    db.add(run); db.commit()
    checkpoint = AgentWorkflowCheckpoint(workflow_id=run.id, sequence=1,
                                         node_name="finance", state_json="{}")
    db.add(checkpoint); db.commit()
    parent_for_owner = db.scalar(select(AgentWorkflowRun).where(
        AgentWorkflowRun.id == run.id, AgentWorkflowRun.user_id == owner.id
    ))
    parent_for_other = db.scalar(select(AgentWorkflowRun).where(
        AgentWorkflowRun.id == run.id, AgentWorkflowRun.user_id == other.id
    ))
    assert parent_for_owner is not None
    assert parent_for_other is None
    # Router fetches checkpoints only after this owner-scoped parent succeeds.
    assert db.scalars(select(AgentWorkflowCheckpoint).where(
        AgentWorkflowCheckpoint.workflow_id == parent_for_owner.id
    )).all()

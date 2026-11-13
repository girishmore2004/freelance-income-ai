import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from .core import settings

# Full CI provides an isolated TEST_DATABASE_URL after applying migrations.
# Never let this test-only override affect a production deployment.
database_url = (
    os.getenv("TEST_DATABASE_URL")
    if settings.environment.lower() != "production" and os.getenv("TEST_DATABASE_URL")
    else settings.database_url
)
connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
engine = create_engine(database_url, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
class Base(DeclarativeBase): pass
def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()

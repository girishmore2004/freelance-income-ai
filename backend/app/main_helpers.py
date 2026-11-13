import json
from sqlalchemy import select
from .models import Profile

def profile_dict(db, user):
    profile = db.scalar(select(Profile).where(Profile.user_id == user.id))
    if not profile:
        return {}
    return {
        "full_name": profile.full_name,
        "headline": profile.headline,
        "bio": profile.bio,
        "skills": json.loads(profile.skills),
        "services": json.loads(profile.services),
        "portfolio_links": json.loads(profile.portfolio_links),
        "minimum_budget": profile.minimum_budget,
        "currency": profile.currency,
        "weekly_hours": profile.weekly_hours,
        "hourly_rate": profile.hourly_rate,
        "timezone": profile.timezone,
        "preferred_work_types": json.loads(profile.preferred_work_types),
        "preferred_industries": json.loads(profile.preferred_industries),
        "dealbreakers": json.loads(profile.dealbreakers),
    }

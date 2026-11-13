
"""Redis-backed fixed-window rate limiting for API abuse resistance."""

from __future__ import annotations

import logging

import jwt

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import (
    BaseHTTPMiddleware,
    RequestResponseEndpoint,
)
from starlette.responses import Response
from starlette.concurrency import run_in_threadpool

from ..core import settings

logger = logging.getLogger(__name__)


class RateLimitStore:
    def __init__(self, redis_url: str):
        from redis import Redis

        self.redis = Redis.from_url(
            redis_url,
            decode_responses=True,
            socket_connect_timeout=1,
            socket_timeout=1,
        )

    def consume(
        self,
        key: str,
        limit: int,
        window_seconds: int,
    ) -> tuple[int, int]:

        pipe = self.redis.pipeline(transaction=True)
        pipe.incr(key)
        pipe.ttl(key)

        count, ttl = pipe.execute()

        if ttl < 0:
            self.redis.expire(key, window_seconds)
            ttl = window_seconds

        return int(count), max(1, int(ttl))


def _actor(request: Request) -> str:
    auth = request.headers.get("authorization", "")

    if auth.lower().startswith("bearer "):
        token = auth.split(" ", 1)[1].strip()

        try:
            claims = jwt.decode(
                token,
                settings.secret_key,
                algorithms=["HS256"],
            )

            subject = claims.get("sub")

            if subject:
                return f"user:{subject}"

        except Exception:
            # Invalid tokens are rate-limited by IP.
            # Normal authentication still validates the token.
            pass

    # Do not trust X-Forwarded-For without explicit trusted-proxy
    # configuration.
    host = request.client.host if request.client else "unknown"

    return f"ip:{host}"


def _policy(path: str) -> tuple[int, int, str]:

    if path.startswith("/api/v1/auth/"):
        return (
            settings.rate_limit_auth_per_minute,
            60,
            "auth",
        )

    if any(
        part in path
        for part in (
            "/ai/",
            "/copilot",
            "/coach",
            "/portfolio/search",
            "/proposals/generate",
        )
    ):
        return (
            settings.rate_limit_ai_per_minute,
            60,
            "ai",
        )

    return (
        settings.rate_limit_api_per_minute,
        60,
        "api",
    )


class RateLimitMiddleware(BaseHTTPMiddleware):

    def __init__(self, app, redis_url: str):
        super().__init__(app)

        self.store = (
            RateLimitStore(redis_url)
            if redis_url
            else None
        )

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:

        if (
            request.method == "OPTIONS"
            or request.url.path == "/health"
            or not request.url.path.startswith("/api/")
        ):
            return await call_next(request)

        if not self.store:

            if settings.environment.lower() == "production":
                return JSONResponse(
                    {
                        "detail": (
                            "Rate-limit service is not configured."
                        )
                    },
                    status_code=503,
                )

            return await call_next(request)

        limit, window, category = _policy(request.url.path)

        key = (
            f"fia:ratelimit:v1:"
            f"{category}:{_actor(request)}"
        )

        try:
            count, retry_after = await run_in_threadpool(
                self.store.consume,
                key,
                limit,
                window,
            )

        except Exception:
            logger.exception(
                "Rate-limit Redis operation failed"
            )

            if settings.environment.lower() == "production":
                return JSONResponse(
                    {
                        "detail": (
                            "Rate-limit service temporarily unavailable."
                        )
                    },
                    status_code=503,
                )

            return await call_next(request)

        if count > limit:

            logger.warning(
                "API rate limit exceeded",
                extra={
                    "category": category,
                    "path": request.url.path,
                },
            )

            actor = _actor(request)

            if actor.startswith("user:"):
                try:
                    should_record = await run_in_threadpool(
                        self.store.redis.set,
                        (
                            f"fia:abuse-event:v1:"
                            f"{category}:{actor}"
                        ),
                        "1",
                        ex=60,
                        nx=True,
                    )

                    if should_record:
                        await run_in_threadpool(
                            _record_rate_limit_event,
                            actor[5:],
                            category,
                            request.url.path,
                        )

                except Exception:
                    logger.exception(
                        "Could not persist rate-limit abuse event"
                    )

            return JSONResponse(
                {
                    "detail": (
                        "Rate limit exceeded. Please retry later."
                    ),
                    "retry_after": retry_after,
                },
                status_code=429,
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Remaining": "0",
                },
            )

        response = await call_next(request)

        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(
            max(0, limit - count)
        )

        return response


def _record_rate_limit_event(
    user_id: str,
    category: str,
    path: str,
) -> None:
    """Best-effort persistent signal; never stores IP addresses or payloads."""

    from ..database import SessionLocal
    from ..models import AbuseEvent

    db = SessionLocal()

    try:
        db.add(
            AbuseEvent(
                user_id=user_id,
                event_type="rate_limit_exceeded",
                detail=(
                    f"category={category}; path={path[:300]}"
                ),
            )
        )

        db.commit()

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()

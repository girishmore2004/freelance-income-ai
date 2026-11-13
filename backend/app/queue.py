from redis import Redis
from rq import Queue
from .core import settings

def get_queue() -> Queue:
    if not settings.redis_url:
        raise RuntimeError("REDIS_URL is not configured; background queue is unavailable")
    connection = Redis.from_url(settings.redis_url, socket_connect_timeout=5, socket_timeout=5)
    connection.ping()
    return Queue("freelance-income-ai", connection=connection, default_timeout=900)

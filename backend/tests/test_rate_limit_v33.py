from app.services.rate_limit import RateLimitStore, _policy


class FakePipeline:
    def __init__(self, redis):
        self.redis = redis
        self.ops = []

    def incr(self, key):
        self.ops.append(("incr", key))
        return self

    def ttl(self, key):
        self.ops.append(("ttl", key))
        return self

    def execute(self):
        result = []
        for op, key in self.ops:
            if op == "incr":
                self.redis.values[key] = self.redis.values.get(key, 0) + 1
                result.append(self.redis.values[key])
            else:
                result.append(self.redis.ttls.get(key, -1))
        return result


class FakeRedis:
    def __init__(self):
        self.values = {}
        self.ttls = {}

    def pipeline(self, transaction=True):
        return FakePipeline(self)

    def expire(self, key, seconds):
        self.ttls[key] = seconds
        return True


def test_rate_limit_store_counts_requests_and_sets_first_expiry():
    store = RateLimitStore.__new__(RateLimitStore)
    store.redis = FakeRedis()

    assert store.consume("key", 5, 60) == (1, 60)
    assert store.consume("key", 5, 60) == (2, 60)
    assert store.redis.ttls["key"] == 60


def test_rate_limit_policy_separates_auth_ai_and_general_api():
    assert _policy("/api/v1/auth/login")[2] == "auth"
    assert _policy("/api/v1/coach/chat")[2] == "ai"
    assert _policy("/api/v1/projects")[2] == "api"

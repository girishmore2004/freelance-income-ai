
from unittest.mock import Mock

import pytest

from app import queue as queue_module


@pytest.fixture(autouse=True)
def clear_queue_cache():
    queue_module._get_queue_for_url.cache_clear()
    yield
    queue_module._get_queue_for_url.cache_clear()


def test_get_queue_reuses_cached_queue_for_same_redis_url(monkeypatch):
    fake_connection = Mock()
    fake_connection.ping.return_value = True

    created_connections = []

    def fake_from_url(url, **kwargs):
        created_connections.append((url, kwargs))
        return fake_connection

    fake_queue = Mock()

    def fake_queue_constructor(name, connection, default_timeout):
        assert name == "freelance-income-ai"
        assert connection is fake_connection
        assert default_timeout == 900
        return fake_queue

    monkeypatch.setattr(
        queue_module.settings,
        "redis_url",
        "redis://localhost:6379/0",
    )
    monkeypatch.setattr(
        queue_module.Redis,
        "from_url",
        fake_from_url,
    )
    monkeypatch.setattr(
        queue_module,
        "Queue",
        fake_queue_constructor,
    )

    first = queue_module.get_queue()
    second = queue_module.get_queue()

    assert first is second
    assert first is fake_queue
    assert len(created_connections) == 1
    fake_connection.ping.assert_called_once()


def test_get_queue_rejects_missing_redis_url(monkeypatch):
    monkeypatch.setattr(
        queue_module.settings,
        "redis_url",
        "",
    )

    with pytest.raises(RuntimeError, match="REDIS_URL"):
        queue_module.get_queue()


def test_get_queue_closes_connection_when_initial_ping_fails(monkeypatch):
    fake_connection = Mock()
    fake_connection.ping.side_effect = OSError("connection refused")

    monkeypatch.setattr(
        queue_module.settings,
        "redis_url",
        "redis://localhost:6379/1",
    )
    monkeypatch.setattr(
        queue_module.Redis,
        "from_url",
        lambda *args, **kwargs: fake_connection,
    )

    with pytest.raises(RuntimeError, match="Unable to connect"):
        queue_module.get_queue()

    fake_connection.close.assert_called_once()


def test_different_redis_urls_use_separate_queue_connections(monkeypatch):
    connections = []

    def fake_from_url(url, **kwargs):
        connection = Mock()
        connection.ping.return_value = True
        connections.append((url, connection))
        return connection

    queues = []

    def fake_queue_constructor(name, connection, default_timeout):
        queue = Mock()
        queue.connection = connection
        queues.append(queue)
        return queue

    monkeypatch.setattr(
        queue_module.Redis,
        "from_url",
        fake_from_url,
    )
    monkeypatch.setattr(
        queue_module,
        "Queue",
        fake_queue_constructor,
    )

    monkeypatch.setattr(
        queue_module.settings,
        "redis_url",
        "redis://localhost:6379/0",
    )
    first = queue_module.get_queue()

    monkeypatch.setattr(
        queue_module.settings,
        "redis_url",
        "redis://localhost:6379/1",
    )
    second = queue_module.get_queue()

    assert first is not second
    assert len(connections) == 2

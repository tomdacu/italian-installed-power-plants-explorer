from __future__ import annotations

import httpx
import pytest

from terna_backend.terna_client import TernaClient, TernaApiError


def _client(handler, **kwargs) -> TernaClient:
    return TernaClient(
        client_id="id",
        client_secret="secret",
        min_request_interval=0,
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
        **kwargs,
    )


def test_retries_rate_limit_and_succeeds() -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/access-token"):
            return httpx.Response(200, json={"access_token": "t", "expires_in": 300})
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(403, text="<h1>Developer Over Qps</h1>")
        return httpx.Response(200, json={"data": []})

    client = _client(handler)
    payload = client.installed_capacity(year=2024)
    assert payload == {"data": []}
    assert calls["n"] == 3


def test_non_retryable_error_raises_immediately() -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/access-token"):
            return httpx.Response(200, json={"access_token": "t", "expires_in": 300})
        calls["n"] += 1
        return httpx.Response(401, text="<html>Unauthorized</html>")

    client = _client(handler)
    with pytest.raises(TernaApiError) as excinfo:
        client.installed_capacity(year=2024)
    # the HTML body is cleaned up in the message
    assert "Unauthorized" in str(excinfo.value)
    assert "<html>" not in str(excinfo.value)
    assert calls["n"] == 1


def test_persists_retry_until_max_attempts() -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/access-token"):
            return httpx.Response(200, json={"access_token": "t", "expires_in": 300})
        calls["n"] += 1
        return httpx.Response(429, headers={"Retry-After": "1"}, text="Too Many Requests")

    client = _client(handler)
    with pytest.raises(TernaApiError) as excinfo:
        client.installed_capacity(year=2024)
    assert calls["n"] == 6  # initial + 5 retries
    assert "attempts" in str(excinfo.value)

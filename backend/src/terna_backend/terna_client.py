from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass
from threading import Lock
from typing import Any

import httpx

TOKEN_URL = "https://api.terna.it/public-api/access-token"
BASE_URL = "https://api.terna.it/generation/v2.0"

# Terna enforces a per-second quota on developer keys ("Developer Over Qps").
# We pace requests and retry rate-limited calls with exponential backoff.
MIN_REQUEST_INTERVAL = max(0.0, float(os.environ.get("TERNA_MIN_REQUEST_INTERVAL", "1.0")))
MAX_RETRIES = 5
RETRY_BACKOFF_SECONDS = (2.0, 4.0, 8.0, 15.0, 30.0)

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"\s+")


class TernaApiError(RuntimeError):
    pass


@dataclass
class Token:
    access_token: str
    expires_at: float


def _clean_error_body(text: str, limit: int = 300) -> str:
    """Strip HTML and collapse whitespace so errors stay readable in the UI."""
    cleaned = _WHITESPACE_RE.sub(" ", _HTML_TAG_RE.sub(" ", text or "")).strip()
    return cleaned[:limit]


def _is_rate_limited(status_code: int, body: str) -> bool:
    if status_code == 429:
        return True
    if status_code == 403:
        marker = body.lower()
        return "qps" in marker or "over" in marker or "rate limit" in marker or "too many" in marker
    return False


class TernaClient:
    def __init__(
        self,
        client_id: str,
        client_secret: str,
        *,
        timeout: float = 30.0,
        min_request_interval: float | None = None,
        http_client: httpx.Client | None = None,
    ) -> None:
        self.client_id = client_id
        self.client_secret = client_secret
        self.timeout = timeout
        self.min_request_interval = (
            MIN_REQUEST_INTERVAL if min_request_interval is None else max(0.0, min_request_interval)
        )
        self._token: Token | None = None
        self._client = http_client or httpx.Client(timeout=timeout)
        self._last_request_at: float = 0.0
        self._pacing_lock = Lock()

    def test_credentials(self) -> bool:
        self._get_token(force=True)
        return True

    def renewable_source_capacity(
        self,
        *,
        year: int,
        source: str | None = None,
        capacity_type: str | None = None,
        region: str | None = None,
        province: str | None = None,
    ) -> dict[str, Any]:
        return self._get(
            "/renewable-source-capacity",
            {
                "year": year,
                "source": source,
                "capacityType": capacity_type,
                "region": region,
                "province": province,
            },
        )

    def generation_plants(
        self,
        *,
        year: int,
        source: str | None = None,
        capacity_type: str | None = None,
        region: str | None = None,
        province: str | None = None,
    ) -> dict[str, Any]:
        return self._get(
            "/generation-plants",
            {
                "year": year,
                "source": source,
                "capacityType": capacity_type,
                "region": region,
                "province": province,
            },
        )

    def installed_capacity(self, *, year: int, type: str | None = None) -> dict[str, Any]:
        return self._get("/installed-capacity", {"year": year, "type": type})

    def thermoelectric_capacity(
        self,
        *,
        year: int,
        capacity_type: str | None = None,
        category: str | None = None,
        subcategory: str | None = None,
        region: str | None = None,
        province: str | None = None,
    ) -> dict[str, Any]:
        return self._get(
            "/thermoelectric-capacity",
            {
                "year": year,
                "capacityType": capacity_type,
                "category": category,
                "subcategory": subcategory,
                "region": region,
                "province": province,
            },
        )

    # ------------------------------------------------------------------
    # internals
    # ------------------------------------------------------------------

    def _throttle(self) -> None:
        """Enforce the minimum interval between consecutive API calls."""
        if self.min_request_interval <= 0:
            return
        with self._pacing_lock:
            elapsed = time.monotonic() - self._last_request_at
            wait = self.min_request_interval - elapsed
            if wait > 0:
                time.sleep(wait)
            self._last_request_at = time.monotonic()

    def _request_with_retries(self, method: str, url: str, *, kwargs: dict[str, Any]) -> httpx.Response:
        """Perform an HTTP call, retrying rate limits and transient errors."""
        last_error: str | None = None
        for attempt in range(MAX_RETRIES + 1):
            self._throttle()
            try:
                response = self._client.request(method, url, **kwargs)
            except httpx.HTTPError as exc:
                last_error = f"network error: {exc.__class__.__name__}"
                response = None

            if response is not None:
                body = response.text or ""
                if response.status_code < 400:
                    return response
                last_error = f"{response.status_code} {_clean_error_body(body)}"
                retryable = _is_rate_limited(response.status_code, body) or response.status_code >= 500
                if not retryable:
                    raise TernaApiError(f"Terna API request failed: {last_error}")
                retry_after = response.headers.get("Retry-After")
            else:
                retryable = True
                retry_after = None

            if attempt >= MAX_RETRIES:
                break

            if retry_after:
                try:
                    delay = min(60.0, max(1.0, float(retry_after)))
                except ValueError:
                    delay = RETRY_BACKOFF_SECONDS[min(attempt, len(RETRY_BACKOFF_SECONDS) - 1)]
            else:
                delay = RETRY_BACKOFF_SECONDS[min(attempt, len(RETRY_BACKOFF_SECONDS) - 1)]
            time.sleep(delay)

        raise TernaApiError(f"Terna API request failed after {MAX_RETRIES + 1} attempts: {last_error}")

    def _get(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        token = self._get_token()
        clean_params = {key: value for key, value in params.items() if value not in (None, "")}
        response = self._request_with_retries(
            "GET",
            BASE_URL + path,
            kwargs={
                "params": clean_params,
                "headers": {
                    "Authorization": f"Bearer {token.access_token}",
                    "Accept": "Application/Json",
                },
            },
        )
        try:
            return response.json()
        except ValueError as exc:
            # Terna answers invalid values (and years with no data yet) with
            # an empty body instead of an error: treat it as "no rows".
            if not (response.text or "").strip():
                return {}
            raise TernaApiError("Terna API returned a non-JSON response") from exc

    def _get_token(self, force: bool = False) -> Token:
        now = time.time()
        if not force and self._token and self._token.expires_at - 30 > now:
            return self._token
        response = self._request_with_retries(
            "POST",
            TOKEN_URL,
            kwargs={
                "data": {
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "grant_type": "client_credentials",
                },
                "headers": {"Content-Type": "application/x-www-form-urlencoded"},
            },
        )
        try:
            payload = response.json()
        except ValueError as exc:
            raise TernaApiError("Terna token response was not valid JSON") from exc
        access_token = payload.get("access_token")
        if not access_token:
            raise TernaApiError("Terna token response did not contain access_token")
        expires_in = int(payload.get("expires_in") or 300)
        self._token = Token(access_token=access_token, expires_at=now + expires_in)
        return self._token

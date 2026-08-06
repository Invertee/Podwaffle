"""Asynchronous client for the Podwaffle local API."""

from __future__ import annotations

import asyncio
from typing import Any
from urllib.parse import urlencode, urljoin, urlsplit, urlunsplit
from uuid import uuid4

from aiohttp import (
    ClientError,
    ClientSession,
    ClientTimeout,
    ClientWebSocketResponse,
    WSServerHandshakeError,
)


class PodwaffleApiError(Exception):
    """Base Podwaffle API error."""


class PodwaffleAuthError(PodwaffleApiError):
    """Raised when a device credential is invalid or revoked."""


class PodwaffleConnectionError(PodwaffleApiError):
    """Raised when Podwaffle cannot be reached."""


class PodwaffleCommandError(PodwaffleApiError):
    """Raised when a playback command cannot be delivered."""


class PodwaffleApi:
    """Small async API client shared by config flow and runtime coordinators."""

    def __init__(
        self,
        session: ClientSession,
        base_url: str,
        token: str | None = None,
        verify_ssl: bool = True,
    ) -> None:
        """Initialize the client."""
        self.session = session
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.verify_ssl = verify_ssl
        self.timeout = ClientTimeout(total=20)

    def _url(self, path: str) -> str:
        return urljoin(f"{self.base_url}/", path.lstrip("/"))

    async def _request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, Any] | None = None,
        authenticated: bool = True,
    ) -> dict[str, Any]:
        headers = {"accept": "application/json"}
        if payload is not None:
            headers["content-type"] = "application/json"
        if authenticated:
            if not self.token:
                raise PodwaffleAuthError("Podwaffle device token is missing")
            headers["authorization"] = f"Bearer {self.token}"
        try:
            async with self.session.request(
                method,
                self._url(path),
                json=payload,
                headers=headers,
                ssl=self.verify_ssl,
                timeout=self.timeout,
            ) as response:
                body: dict[str, Any] = {}
                if response.status != 204:
                    try:
                        parsed = await response.json(content_type=None)
                        if isinstance(parsed, dict):
                            body = parsed
                    except (ValueError, ClientError):
                        body = {}
                if response.status == 401:
                    message = (
                        _error_message(body)
                        or "Podwaffle credentials were rejected"
                    )
                    raise PodwaffleAuthError(message)
                if response.status >= 400:
                    message = (
                        _error_message(body)
                        or f"Podwaffle request failed ({response.status})"
                    )
                    raise PodwaffleApiError(message)
                return body
        except PodwaffleApiError:
            raise
        except (TimeoutError, ClientError) as err:
            raise PodwaffleConnectionError(
                "Podwaffle could not be reached"
            ) from err

    async def async_profiles(self) -> list[dict[str, Any]]:
        """Return enabled Podwaffle profiles."""
        result = await self._request(
            "GET", "/api/v1/join/profiles", authenticated=False
        )
        profiles = result.get("profiles")
        return profiles if isinstance(profiles, list) else []

    async def async_join(
        self,
        profile_id: str,
        join_code: str,
        device_name: str,
        app_version: str,
    ) -> dict[str, Any]:
        """Create a restricted controller credential for one profile."""
        return await self._request(
            "POST",
            "/api/v1/join",
            authenticated=False,
            payload={
                "profileId": profile_id,
                "joinCode": join_code,
                "deviceName": device_name,
                "platform": "home_assistant",
                "appVersion": app_version,
            },
        )

    async def async_snapshot(self) -> dict[str, Any]:
        """Return the complete profile snapshot."""
        return await self._request("GET", "/api/v1/snapshot")

    async def async_stats(self, period: str) -> dict[str, Any]:
        """Return listening statistics for a period."""
        result = await self._request("GET", f"/api/v1/stats?period={period}")
        stats = result.get("stats")
        return stats if isinstance(stats, dict) else {}

    async def async_playback_command(
        self,
        action: str,
        **parameters: Any,
    ) -> dict[str, Any]:
        """Relay a media control command to the active Podwaffle client."""
        command_id = str(uuid4())
        result = await self._request(
            "POST",
            "/api/v1/playback/commands",
            payload={"commandId": command_id, "action": action, **parameters},
        )
        status = result.get("status")
        if status == "pending" and not result.get("delivered"):
            raise PodwaffleCommandError(
                "The active Podwaffle playback device is not connected"
            )
        if status in {"rejected", "cancelled"}:
            raise PodwaffleCommandError(_command_error(result))
        if status != "pending":
            return result

        # The REST dispatch is intentionally asynchronous. Poll its requester-only
        # status endpoint briefly so Home Assistant actions report a client-side
        # rejection rather than appearing successful. The later WebSocket state
        # event remains authoritative for entity state.
        for _attempt in range(20):
            await asyncio.sleep(0.25)
            confirmed = await self._request(
                "GET", f"/api/v1/playback/commands/{command_id}"
            )
            confirmed_status = confirmed.get("status")
            if confirmed_status == "accepted":
                return confirmed
            if confirmed_status in {"rejected", "cancelled"}:
                raise PodwaffleCommandError(_command_error(confirmed))
        return result

    async def async_websocket(
        self,
        after_revision: int,
    ) -> ClientWebSocketResponse:
        """Open the profile-scoped live-sync WebSocket."""
        if not self.token:
            raise PodwaffleAuthError("Podwaffle device token is missing")
        split = urlsplit(self._url("ws"))
        scheme = "wss" if split.scheme == "https" else "ws"
        query = urlencode(
            {"token": self.token, "afterRevision": max(0, after_revision)}
        )
        url = urlunsplit((scheme, split.netloc, split.path, query, ""))
        try:
            async with asyncio.timeout(20):
                return await self.session.ws_connect(
                    url,
                    heartbeat=30,
                    ssl=self.verify_ssl,
                )
        except WSServerHandshakeError as err:
            if err.status == 401:
                raise PodwaffleAuthError(
                    "Podwaffle credentials were rejected"
                ) from err
            raise PodwaffleConnectionError(
                f"Podwaffle live sync failed ({err.status})"
            ) from err
        except (TimeoutError, ClientError) as err:
            raise PodwaffleConnectionError(
                "Podwaffle live sync could not be reached"
            ) from err

    def absolute_url(self, value: str | None) -> str | None:
        """Resolve relative artwork URLs against the configured server."""
        if not value:
            return None
        return urljoin(f"{self.base_url}/", value)


def _error_message(body: dict[str, Any]) -> str | None:
    error = body.get("error")
    if isinstance(error, dict):
        message = error.get("message")
        if isinstance(message, str):
            return message
    return None


def _command_error(body: dict[str, Any]) -> str:
    result = body.get("result")
    if isinstance(result, dict):
        message = result.get("message")
        if isinstance(message, str) and message:
            return message
    return "The playback device rejected the command"

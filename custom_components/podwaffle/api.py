from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from aiohttp import ClientError, ClientSession


class PodwaffleApiError(Exception):
    """Raised when the Podwaffle API returns an error."""


@dataclass
class PodwaffleApiClient:
    session: ClientSession
    server_url: str
    user_guid: str

    def __post_init__(self) -> None:
        self.server_url = self.server_url.rstrip("/")

    async def _request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
        url = f"{self.server_url}{path}"
        try:
            async with self.session.request(method, url, json=payload) as response:
                text = await response.text()
                if response.status >= 400:
                    raise PodwaffleApiError(f"HTTP {response.status} from {url}: {text}")
                if not text:
                    return None
                return await response.json()
        except ClientError as err:
            raise PodwaffleApiError(f"Request failed for {url}: {err}") from err

    async def async_get_media_player_state(self) -> dict[str, Any]:
        return await self._request("GET", f"/api/ha/media-player/{self.user_guid}/state")

    async def async_send_command(self, command: str, value: float | int | None = None) -> dict[str, Any] | None:
        payload: dict[str, Any] = {"command": command}
        if command == "seek" and value is not None:
            payload["position"] = value
            payload["value"] = value
        elif command == "set_volume" and value is not None:
            payload["volume"] = value
            payload["value"] = value
        elif value is not None:
            payload["value"] = value

        return await self._request("POST", f"/api/ha/media-player/{self.user_guid}/command", payload)

    async def async_validate(self) -> dict[str, Any]:
        return await self.async_get_media_player_state()
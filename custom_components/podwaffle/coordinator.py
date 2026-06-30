from __future__ import annotations

from datetime import timedelta
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import PodwaffleApiClient, PodwaffleApiError
from .const import DEFAULT_SCAN_INTERVAL_SECONDS, DOMAIN


class PodwaffleCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Coordinator to poll Podwaffle bridge state."""

    def __init__(self, hass: HomeAssistant, api: PodwaffleApiClient) -> None:
        super().__init__(
            hass,
            hass.data[DOMAIN]["logger"],
            name=f"{DOMAIN}_{api.user_guid}",
            update_interval=timedelta(seconds=DEFAULT_SCAN_INTERVAL_SECONDS),
        )
        self.api = api

    async def _async_update_data(self) -> dict[str, Any]:
        try:
            return await self.api.async_get_media_player_state()
        except PodwaffleApiError as err:
            raise UpdateFailed(str(err)) from err
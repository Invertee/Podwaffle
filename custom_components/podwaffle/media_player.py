from __future__ import annotations

from typing import Any

from homeassistant.components.media_player import MediaPlayerEntity
from homeassistant.components.media_player.const import (
    MediaPlayerEntityFeature,
    MediaPlayerState,
    MediaType,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .api import PodwaffleApiClient
from .const import CONF_SERVER_URL, CONF_USER_GUID
from .coordinator import PodwaffleCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    session = async_get_clientsession(hass)
    api = PodwaffleApiClient(session, entry.data[CONF_SERVER_URL], entry.data[CONF_USER_GUID])
    coordinator = PodwaffleCoordinator(hass, api)
    await coordinator.async_config_entry_first_refresh()

    async_add_entities([PodwaffleMediaPlayerEntity(entry, coordinator, api)])


class PodwaffleMediaPlayerEntity(CoordinatorEntity[PodwaffleCoordinator], MediaPlayerEntity):
    _attr_has_entity_name = True
    _attr_name = "Player"
    _attr_media_content_type = MediaType.PODCAST
    _attr_supported_features = (
        MediaPlayerEntityFeature.PLAY
        | MediaPlayerEntityFeature.PAUSE
        | MediaPlayerEntityFeature.STOP
        | MediaPlayerEntityFeature.VOLUME_SET
        | MediaPlayerEntityFeature.SEEK
        | MediaPlayerEntityFeature.NEXT_TRACK
        | MediaPlayerEntityFeature.PREVIOUS_TRACK
        | MediaPlayerEntityFeature.PLAY_MEDIA
    )

    def __init__(self, entry: ConfigEntry, coordinator: PodwaffleCoordinator, api: PodwaffleApiClient) -> None:
        super().__init__(coordinator)
        self._entry = entry
        self._api = api
        self._guid = entry.data[CONF_USER_GUID]
        self._attr_unique_id = f"podwaffle_media_player_{self._guid}"

    @property
    def available(self) -> bool:
        return super().available and self.coordinator.data is not None

    @property
    def state(self) -> MediaPlayerState:
        state = (self.coordinator.data or {}).get("state", "idle")
        if state == "playing":
            return MediaPlayerState.PLAYING
        if state == "paused":
            return MediaPlayerState.PAUSED
        return MediaPlayerState.IDLE

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        data = self.coordinator.data or {}
        return {
            "guid": data.get("guid") or self._guid,
            "mode": data.get("mode"),
            "episode_guid": data.get("episode_guid"),
            "podwaffle_entity_id": data.get("entity_id"),
            "supported_commands": data.get("supported_commands", []),
            "updated_at": data.get("updated_at"),
        }

    @property
    def media_title(self) -> str | None:
        return (self.coordinator.data or {}).get("media_title")

    @property
    def media_series_title(self) -> str | None:
        return (self.coordinator.data or {}).get("media_series_title")

    @property
    def media_image_url(self) -> str | None:
        return (self.coordinator.data or {}).get("media_image_url")

    @property
    def media_position(self) -> float | None:
        return (self.coordinator.data or {}).get("media_position")

    @property
    def media_duration(self) -> float | None:
        return (self.coordinator.data or {}).get("media_duration")

    @property
    def volume_level(self) -> float | None:
        return (self.coordinator.data or {}).get("volume_level")

    async def _send(self, command: str, value: float | int | None = None) -> None:
        await self._api.async_send_command(command, value)
        await self.coordinator.async_request_refresh()

    async def async_media_play(self) -> None:
        await self._send("play")

    async def async_media_pause(self) -> None:
        await self._send("pause")

    async def async_media_stop(self) -> None:
        await self._send("stop")

    async def async_toggle(self) -> None:
        await self._send("play_pause")

    async def async_media_next_track(self) -> None:
        await self._send("next")

    async def async_media_previous_track(self) -> None:
        await self._send("previous")

    async def async_set_volume_level(self, volume: float) -> None:
        await self._send("set_volume", volume)

    async def async_media_seek(self, position: float) -> None:
        await self._send("seek", position)

    async def async_play_media(self, media_type: MediaType | str, media_id: str, **kwargs: Any) -> None:
        if str(media_type).lower() in {"seek", "position"}:
            await self._send("seek", float(media_id))
            return
        await self._send("play")
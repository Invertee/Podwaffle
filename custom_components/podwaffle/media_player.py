"""Media player entities for Podwaffle profiles."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from homeassistant.components.media_player import (
    MediaPlayerEntity,
    MediaPlayerEntityFeature,
)
from homeassistant.components.media_player.const import MediaPlayerState, MediaType
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import coordinators_for_entry
from .api import PodwaffleApiError
from .coordinator import PodwaffleCoordinator
from .entity import PodwaffleEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up one media player per selected Podwaffle profile."""
    async_add_entities(
        PodwaffleMediaPlayer(coordinator)
        for coordinator in coordinators_for_entry(hass, entry).values()
    )


class PodwaffleMediaPlayer(PodwaffleEntity, MediaPlayerEntity):
    """Remote-control the active Podwaffle client for one profile."""

    _attr_name = None
    _attr_icon = "mdi:podcast"
    _attr_supported_features = (
        MediaPlayerEntityFeature.PLAY
        | MediaPlayerEntityFeature.PAUSE
        | MediaPlayerEntityFeature.SEEK
        | MediaPlayerEntityFeature.NEXT_TRACK
        | MediaPlayerEntityFeature.PREVIOUS_TRACK
    )

    def __init__(self, coordinator: PodwaffleCoordinator) -> None:
        """Initialize the media player."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.profile_id}_player"

    @property
    def _snapshot(self) -> dict[str, Any]:
        return self.coordinator.data.snapshot

    @property
    def _playback(self) -> dict[str, Any]:
        playback = self._snapshot.get("playback")
        return playback if isinstance(playback, dict) else {}

    @property
    def _episode(self) -> dict[str, Any]:
        episode = self._playback.get("episode")
        return episode if isinstance(episode, dict) else {}

    @property
    def state(self) -> MediaPlayerState:
        """Return the current playback state."""
        if not self._episode or self._playback.get("state") == "stopped":
            return MediaPlayerState.IDLE
        if self._playback.get("state") == "playing":
            return MediaPlayerState.PLAYING
        return MediaPlayerState.PAUSED

    @property
    def media_title(self) -> str | None:
        value = self._episode.get("title")
        return value if isinstance(value, str) else None

    @property
    def media_artist(self) -> str | None:
        value = self._episode.get("podcastTitle")
        return value if isinstance(value, str) else None

    @property
    def media_series_title(self) -> str | None:
        return self.media_artist

    @property
    def media_content_id(self) -> str | None:
        value = self._episode.get("id")
        return value if isinstance(value, str) else None

    @property
    def media_content_type(self) -> str | None:
        return MediaType.PODCAST if self._episode else None

    @property
    def media_duration(self) -> float | None:
        duration = self._playback.get("durationMs")
        if not isinstance(duration, (int, float)):
            duration = self._episode.get("durationMs")
        return float(duration) / 1000 if isinstance(duration, (int, float)) else None

    @property
    def media_position(self) -> float | None:
        position = self._playback.get("positionMs")
        return float(position) / 1000 if isinstance(position, (int, float)) else None

    @property
    def media_position_updated_at(self) -> datetime | None:
        return self.coordinator.last_snapshot_at

    @property
    def media_image_url(self) -> str | None:
        artwork = self._episode.get("artworkUrl") or self._episode.get(
            "podcastArtworkUrl"
        )
        return self.coordinator.api.absolute_url(
            artwork if isinstance(artwork, str) else None
        )

    @property
    def source(self) -> str | None:
        """Return the current rendering device name."""
        device_id = (
            self._playback.get("castOwnerDeviceId")
            if self._playback.get("mode") == "cast"
            else self._playback.get("activeDeviceId")
        )
        devices = self._snapshot.get("devices")
        if isinstance(devices, list):
            for device in devices:
                if isinstance(device, dict) and device.get("id") == device_id:
                    name = device.get("name")
                    return name if isinstance(name, str) else None
        return None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        queue = self._snapshot.get("queue")
        return {
            "profile": self.coordinator.profile_name,
            "mode": self._playback.get("mode", "local"),
            "playback_rate": self._playback.get("playbackRate", 1),
            "active_device": self.source,
            "queue_episodes": len(queue) if isinstance(queue, list) else 0,
        }

    async def async_media_play(self) -> None:
        await self._command("play")

    async def async_media_pause(self) -> None:
        await self._command("pause")

    async def async_media_seek(self, position: float) -> None:
        await self._command("seek", positionMs=max(0, round(position * 1000)))

    async def async_media_next_track(self) -> None:
        await self._command("next")

    async def async_media_previous_track(self) -> None:
        await self._command("previous")

    async def _command(self, action: str, **parameters: Any) -> None:
        try:
            await self.coordinator.async_send_command(action, **parameters)
        except PodwaffleApiError as err:
            raise HomeAssistantError(str(err)) from err

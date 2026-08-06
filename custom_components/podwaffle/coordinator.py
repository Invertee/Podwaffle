"""Data coordination and live sync for Podwaffle profiles."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime
import logging
from typing import Any

from aiohttp import WSMsgType
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .api import (
    PodwaffleApi,
    PodwaffleApiError,
    PodwaffleAuthError,
    PodwaffleConnectionError,
)
from .const import STATS_INTERVAL, UPDATE_INTERVAL, PodwaffleProfileConfig

_LOGGER = logging.getLogger(__name__)


@dataclass(slots=True)
class PodwaffleProfileData:
    """State used by all entities for one Podwaffle profile."""

    snapshot: dict[str, Any]
    stats_today: dict[str, Any]
    stats_30d: dict[str, Any]


class PodwaffleCoordinator(DataUpdateCoordinator[PodwaffleProfileData]):
    """Coordinate REST snapshots and push refreshes for one profile."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        api: PodwaffleApi,
        profile: PodwaffleProfileConfig,
    ) -> None:
        """Initialize the coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=f"Podwaffle {profile['profile_name']}",
            update_interval=UPDATE_INTERVAL,
        )
        self.entry = entry
        self.api = api
        self.profile_id = profile["profile_id"]
        self.profile_name = profile["profile_name"]
        self.device_id = profile["device_id"]
        self.last_snapshot_at: datetime | None = None
        self._stats_updated_at: datetime | None = None
        self._stats_today: dict[str, Any] = {}
        self._stats_30d: dict[str, Any] = {}
        self._websocket_task: asyncio.Task[None] | None = None
        self._refresh_task: asyncio.Task[None] | None = None
        self._stopping = False

    async def _async_update_data(self) -> PodwaffleProfileData:
        """Fetch the latest snapshot and periodically refresh statistics."""
        try:
            snapshot = await self.api.async_snapshot()
            now = dt_util.utcnow()
            refresh_stats = (
                self._stats_updated_at is None
                or now - self._stats_updated_at >= STATS_INTERVAL
            )
            if refresh_stats:
                self._stats_today, self._stats_30d = await asyncio.gather(
                    self.api.async_stats("today"),
                    self.api.async_stats("30d"),
                )
                self._stats_updated_at = now
            self.last_snapshot_at = now
            return PodwaffleProfileData(
                snapshot=snapshot,
                stats_today=self._stats_today,
                stats_30d=self._stats_30d,
            )
        except PodwaffleAuthError as err:
            raise ConfigEntryAuthFailed from err
        except PodwaffleApiError as err:
            raise UpdateFailed(str(err)) from err

    def async_start_live_sync(self) -> None:
        """Start the profile WebSocket after the first successful refresh."""
        if self._websocket_task and not self._websocket_task.done():
            return
        self._stopping = False
        self._websocket_task = self.entry.async_create_background_task(
            self.hass,
            self._async_listen(),
            f"podwaffle-{self.profile_id}-live-sync",
        )

    async def async_shutdown(self) -> None:
        """Stop live sync and pending refresh tasks."""
        self._stopping = True
        tasks = [self._websocket_task, self._refresh_task]
        for task in tasks:
            if task and not task.done():
                task.cancel()
        for task in tasks:
            if task:
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        self._websocket_task = None
        self._refresh_task = None

    async def async_send_command(self, action: str, **parameters: Any) -> None:
        """Send a command and refresh the entity state."""
        await self.api.async_playback_command(action, **parameters)
        await self.async_request_refresh()

    async def _async_listen(self) -> None:
        backoff = 1
        while not self._stopping:
            revision = 0
            if self.data:
                revision = int(self.data.snapshot.get("revision", 0))
            websocket = None
            try:
                websocket = await self.api.async_websocket(revision)
                backoff = 1
                async for message in websocket:
                    if self._stopping:
                        return
                    if message.type == WSMsgType.TEXT:
                        payload = message.json()
                        message_type = payload.get("type")
                        if message_type == "sync.event":
                            event = payload.get("event")
                            if isinstance(event, dict):
                                if event.get("type") in {
                                    "stats.updated",
                                    "history.updated",
                                }:
                                    self._stats_updated_at = None
                                self._schedule_refresh()
                        elif (
                            message_type == "server.notice"
                            and payload.get("code") == "SNAPSHOT_REQUIRED"
                        ):
                            self._schedule_refresh()
                            break
                    elif message.type in {
                        WSMsgType.CLOSE,
                        WSMsgType.CLOSED,
                        WSMsgType.ERROR,
                    }:
                        break
            except asyncio.CancelledError:
                raise
            except PodwaffleAuthError:
                self.entry.async_start_reauth(self.hass)
                return
            except (PodwaffleConnectionError, ValueError) as err:
                _LOGGER.debug(
                    "Podwaffle live sync disconnected for %s: %s",
                    self.profile_name,
                    err,
                )
            finally:
                if websocket is not None and not websocket.closed:
                    await websocket.close()
            if not self._stopping:
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60)

    def _schedule_refresh(self) -> None:
        if self._refresh_task and not self._refresh_task.done():
            return
        self._refresh_task = self.entry.async_create_background_task(
            self.hass,
            self._async_debounced_refresh(),
            f"podwaffle-{self.profile_id}-push-refresh",
        )

    async def _async_debounced_refresh(self) -> None:
        await asyncio.sleep(0.75)
        await self.async_request_refresh()

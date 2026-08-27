"""Notification entities for Podwaffle profiles."""

from __future__ import annotations

from homeassistant.components.notify import NotifyEntity, NotifyEntityFeature
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
    """Set up one notification target per selected Podwaffle profile."""
    async_add_entities(
        PodwaffleNotify(coordinator)
        for coordinator in coordinators_for_entry(hass, entry).values()
    )


class PodwaffleNotify(PodwaffleEntity, NotifyEntity):
    """Send messages to Android devices enrolled in one profile."""

    _attr_name = None
    _attr_icon = "mdi:message-badge-outline"
    _attr_supported_features = NotifyEntityFeature.TITLE

    def __init__(self, coordinator: PodwaffleCoordinator) -> None:
        """Initialize the profile notification target."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.profile_id}_notifications"

    async def async_send_message(
        self,
        message: str,
        title: str | None = None,
    ) -> None:
        """Send a join-code-encrypted message through Podwaffle FCM."""
        try:
            await self.coordinator.api.async_send_notification(message, title)
        except PodwaffleApiError as err:
            raise HomeAssistantError(str(err)) from err

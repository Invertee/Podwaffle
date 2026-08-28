"""Notification send buttons for Podwaffle profiles."""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
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
    """Set up one notification send button per selected profile."""
    async_add_entities(
        PodwaffleSendNotificationButton(coordinator)
        for coordinator in coordinators_for_entry(hass, entry).values()
    )


class PodwaffleSendNotificationButton(PodwaffleEntity, ButtonEntity):
    """Send the current notification draft to enrolled Android devices."""

    _attr_name = "Send notification"
    _attr_icon = "mdi:send"

    def __init__(self, coordinator: PodwaffleCoordinator) -> None:
        """Initialize the notification send button."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.profile_id}_send_notification"

    async def async_press(self) -> None:
        """Encrypt and send the current title and message draft."""
        title = self.coordinator.notification_title.strip()
        message = self.coordinator.notification_message.strip()
        if not message:
            raise HomeAssistantError(
                "Enter a notification message before pressing Send notification"
            )
        try:
            await self.coordinator.api.async_send_notification(message, title)
        except PodwaffleApiError as err:
            raise HomeAssistantError(str(err)) from err

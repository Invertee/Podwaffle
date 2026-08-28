"""Notification draft fields for Podwaffle profiles."""

from __future__ import annotations

from homeassistant.components.text import TextEntity, TextMode
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import coordinators_for_entry
from .coordinator import PodwaffleCoordinator
from .entity import PodwaffleEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up notification title and message fields for each profile."""
    entities: list[TextEntity] = []
    for coordinator in coordinators_for_entry(hass, entry).values():
        entities.extend(
            (
                PodwaffleNotificationTitle(coordinator),
                PodwaffleNotificationMessage(coordinator),
            )
        )
    async_add_entities(entities)


class PodwaffleNotificationTitle(PodwaffleEntity, TextEntity):
    """Editable title for the next ad-hoc notification."""

    _attr_name = "Notification title"
    _attr_icon = "mdi:format-title"
    _attr_mode = TextMode.TEXT
    _attr_native_min = 0
    _attr_native_max = 200

    def __init__(self, coordinator: PodwaffleCoordinator) -> None:
        """Initialize the notification title field."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.profile_id}_notification_title"

    @property
    def native_value(self) -> str:
        """Return the current draft title."""
        return self.coordinator.notification_title

    async def async_set_value(self, value: str) -> None:
        """Update the draft title without sending it."""
        self.coordinator.notification_title = value
        self.async_write_ha_state()


class PodwaffleNotificationMessage(PodwaffleEntity, TextEntity):
    """Editable message for the next ad-hoc notification."""

    _attr_name = "Notification message"
    _attr_icon = "mdi:message-text-outline"
    _attr_mode = TextMode.TEXT
    _attr_native_min = 0
    # Home Assistant entity states are limited to 255 characters.
    _attr_native_max = 255

    def __init__(self, coordinator: PodwaffleCoordinator) -> None:
        """Initialize the notification message field."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.profile_id}_notification_message"

    @property
    def native_value(self) -> str:
        """Return the current draft message."""
        return self.coordinator.notification_message

    async def async_set_value(self, value: str) -> None:
        """Update the draft message without sending it."""
        self.coordinator.notification_message = value
        self.async_write_ha_state()

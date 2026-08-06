"""Shared Podwaffle entity helpers."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import PodwaffleCoordinator


class PodwaffleEntity(CoordinatorEntity[PodwaffleCoordinator]):
    """Base entity representing a Podwaffle profile."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: PodwaffleCoordinator) -> None:
        """Initialize the entity."""
        super().__init__(coordinator)
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, coordinator.profile_id)},
            name=f"Podwaffle {coordinator.profile_name}",
            manufacturer="Podwaffle",
            model="Profile",
            configuration_url=coordinator.api.base_url,
        )

"""Podwaffle Home Assistant integration."""

from __future__ import annotations

from typing import cast

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import PodwaffleApi
from .const import (
    CONF_BASE_URL,
    CONF_PROFILES,
    CONF_VERIFY_SSL,
    DOMAIN,
    PLATFORMS,
    PodwaffleProfileConfig,
)
from .coordinator import PodwaffleCoordinator


def coordinators_for_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> dict[str, PodwaffleCoordinator]:
    """Return coordinators registered for a config entry."""
    return hass.data[DOMAIN][entry.entry_id]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Podwaffle from a config entry."""
    session = async_get_clientsession(hass)
    base_url = str(entry.data[CONF_BASE_URL])
    verify_ssl = bool(entry.data.get(CONF_VERIFY_SSL, True))
    profiles = entry.data.get(CONF_PROFILES, [])
    coordinators: dict[str, PodwaffleCoordinator] = {}

    try:
        for raw_profile in profiles:
            profile = cast(PodwaffleProfileConfig, dict(raw_profile))
            api = PodwaffleApi(
                session,
                base_url,
                profile["token"],
                verify_ssl,
            )
            coordinator = PodwaffleCoordinator(hass, entry, api, profile)
            await coordinator.async_config_entry_first_refresh()
            coordinators[profile["profile_id"]] = coordinator
    except Exception:
        for coordinator in coordinators.values():
            await coordinator.async_shutdown()
        raise

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinators
    entity_registry = er.async_get(hass)
    for profile_id in coordinators:
        legacy_entity_id = entity_registry.async_get_entity_id(
            "notify", DOMAIN, f"{profile_id}_notifications"
        )
        if legacy_entity_id:
            entity_registry.async_remove(legacy_entity_id)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    for coordinator in coordinators.values():
        coordinator.async_start_live_sync()
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a Podwaffle config entry."""
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if not unloaded:
        return False
    coordinators: dict[str, PodwaffleCoordinator] = hass.data[DOMAIN].pop(
        entry.entry_id,
        {},
    )
    for coordinator in coordinators.values():
        await coordinator.async_shutdown()
    if not hass.data[DOMAIN]:
        hass.data.pop(DOMAIN)
    return True

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import PodwaffleApiClient, PodwaffleApiError
from .const import CONF_SERVER_URL, CONF_USER_GUID, DOMAIN


async def validate_input(hass, data: dict[str, Any]) -> dict[str, Any]:
    """Validate the user input allows us to connect."""
    session = async_get_clientsession(hass)
    api = PodwaffleApiClient(session, data[CONF_SERVER_URL], data[CONF_USER_GUID])
    state = await api.async_validate()

    entity_id = state.get("entity_id") or f"media_player.podwaffle_{data[CONF_USER_GUID]}"
    return {
        "title": f"Podwaffle {data[CONF_USER_GUID][:8]}",
        "entity_id": entity_id,
    }


class PodwaffleConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        errors: dict[str, str] = {}

        if user_input is not None:
            normalized = {
                CONF_SERVER_URL: str(user_input[CONF_SERVER_URL]).strip().rstrip("/"),
                CONF_USER_GUID: str(user_input[CONF_USER_GUID]).strip(),
            }

            try:
                info = await validate_input(self.hass, normalized)
            except PodwaffleApiError:
                errors["base"] = "cannot_connect"
            except Exception:
                errors["base"] = "unknown"
            else:
                unique = f"{normalized[CONF_SERVER_URL]}|{normalized[CONF_USER_GUID]}"
                await self.async_set_unique_id(unique)
                self._abort_if_unique_id_configured()
                return self.async_create_entry(title=info["title"], data=normalized)

        data_schema = vol.Schema(
            {
                vol.Required(CONF_SERVER_URL, default="http://homeassistant.local:3000"): str,
                vol.Required(CONF_USER_GUID): str,
            }
        )

        return self.async_show_form(step_id="user", data_schema=data_schema, errors=errors)
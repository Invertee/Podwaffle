"""Config flow for the Podwaffle integration."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers import selector

from .api import (
    PodwaffleApi,
    PodwaffleApiError,
    PodwaffleAuthError,
    PodwaffleConnectionError,
)
from .const import (
    CONF_BASE_URL,
    CONF_JOIN_CODE,
    CONF_PROFILE_IDS,
    CONF_PROFILES,
    CONF_VERIFY_SSL,
    DOMAIN,
    INTEGRATION_VERSION,
)


class PodwaffleConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a Podwaffle config flow."""

    VERSION = 1

    def __init__(self) -> None:
        """Initialize the flow."""
        self._base_url = ""
        self._join_code = ""
        self._verify_ssl = True
        self._available_profiles: list[dict[str, Any]] = []
        self._reauth_entry: config_entries.ConfigEntry | None = None

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        """Collect server details and validate the connection."""
        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                self._base_url = _normalize_url(str(user_input[CONF_BASE_URL]))
                self._join_code = str(user_input[CONF_JOIN_CODE])
                self._verify_ssl = bool(user_input.get(CONF_VERIFY_SSL, True))
                await self.async_set_unique_id(self._base_url.lower())
                self._abort_if_unique_id_configured()
                api = PodwaffleApi(
                    async_get_clientsession(self.hass),
                    self._base_url,
                    verify_ssl=self._verify_ssl,
                )
                self._available_profiles = await api.async_profiles()
                if not self._available_profiles:
                    errors["base"] = "no_profiles"
                else:
                    return await self.async_step_profiles()
            except ValueError:
                errors[CONF_BASE_URL] = "invalid_url"
            except PodwaffleConnectionError:
                errors["base"] = "cannot_connect"
            except PodwaffleApiError:
                errors["base"] = "unknown"

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_BASE_URL): selector.TextSelector(
                        selector.TextSelectorConfig(
                            type=selector.TextSelectorType.URL,
                        )
                    ),
                    vol.Required(CONF_JOIN_CODE): selector.TextSelector(
                        selector.TextSelectorConfig(
                            type=selector.TextSelectorType.PASSWORD,
                        )
                    ),
                    vol.Optional(CONF_VERIFY_SSL, default=True): selector.BooleanSelector(),
                }
            ),
            errors=errors,
        )

    async def async_step_profiles(
        self,
        user_input: dict[str, Any] | None = None,
    ):
        """Select profiles and create one restricted token per profile."""
        errors: dict[str, str] = {}
        if user_input is not None:
            selected = user_input.get(CONF_PROFILE_IDS, [])
            if isinstance(selected, str):
                selected = [selected]
            selected_ids = {str(value) for value in selected}
            if not selected_ids:
                errors[CONF_PROFILE_IDS] = "profiles_required"
            else:
                try:
                    profiles = await self._async_join_profiles(selected_ids)
                    host = urlsplit(self._base_url).hostname or self._base_url
                    return self.async_create_entry(
                        title=f"Podwaffle ({host})",
                        data={
                            CONF_BASE_URL: self._base_url,
                            CONF_VERIFY_SSL: self._verify_ssl,
                            CONF_PROFILES: profiles,
                        },
                    )
                except PodwaffleAuthError:
                    errors["base"] = "invalid_auth"
                except PodwaffleConnectionError:
                    errors["base"] = "cannot_connect"
                except PodwaffleApiError:
                    errors["base"] = "unknown"

        options = [
            selector.SelectOptionDict(
                value=str(profile["id"]),
                label=str(profile["displayName"]),
            )
            for profile in self._available_profiles
            if profile.get("id") and profile.get("displayName")
        ]
        default = [option["value"] for option in options]
        return self.async_show_form(
            step_id="profiles",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_PROFILE_IDS, default=default): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=options,
                            multiple=True,
                            mode=selector.SelectSelectorMode.LIST,
                        )
                    )
                }
            ),
            errors=errors,
        )

    async def async_step_reauth(self, entry_data: Mapping[str, Any]):
        """Start reauthentication after a controller token is revoked."""
        entry_id = self.context.get("entry_id")
        self._reauth_entry = (
            self.hass.config_entries.async_get_entry(str(entry_id))
            if entry_id
            else None
        )
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(
        self,
        user_input: dict[str, Any] | None = None,
    ):
        """Rejoin all configured profiles with a fresh join code."""
        errors: dict[str, str] = {}
        entry = self._reauth_entry
        if entry is None:
            return self.async_abort(reason="reauth_failed")
        if user_input is not None:
            try:
                self._base_url = str(entry.data[CONF_BASE_URL])
                self._verify_ssl = bool(entry.data.get(CONF_VERIFY_SSL, True))
                self._join_code = str(user_input[CONF_JOIN_CODE])
                existing = entry.data.get(CONF_PROFILES, [])
                self._available_profiles = [
                    {
                        "id": profile["profile_id"],
                        "displayName": profile["profile_name"],
                    }
                    for profile in existing
                ]
                profiles = await self._async_join_profiles(
                    {str(profile["profile_id"]) for profile in existing}
                )
                return self.async_update_reload_and_abort(
                    entry,
                    data_updates={CONF_PROFILES: profiles},
                )
            except PodwaffleAuthError:
                errors["base"] = "invalid_auth"
            except PodwaffleConnectionError:
                errors["base"] = "cannot_connect"
            except PodwaffleApiError:
                errors["base"] = "unknown"

        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_JOIN_CODE): selector.TextSelector(
                        selector.TextSelectorConfig(
                            type=selector.TextSelectorType.PASSWORD,
                        )
                    )
                }
            ),
            errors=errors,
        )

    async def _async_join_profiles(
        self,
        selected_ids: set[str],
    ) -> list[dict[str, str]]:
        api = PodwaffleApi(
            async_get_clientsession(self.hass),
            self._base_url,
            verify_ssl=self._verify_ssl,
        )
        device_name = f"Home Assistant ({self.hass.config.location_name})"[:100]
        joined: list[dict[str, str]] = []
        for profile in self._available_profiles:
            profile_id = str(profile.get("id", ""))
            if profile_id not in selected_ids:
                continue
            result = await api.async_join(
                profile_id,
                self._join_code,
                device_name,
                INTEGRATION_VERSION,
            )
            session = result.get("session")
            device = session.get("device") if isinstance(session, dict) else None
            returned_profile = (
                session.get("profile") if isinstance(session, dict) else None
            )
            token = result.get("token")
            if (
                not isinstance(token, str)
                or not isinstance(device, dict)
                or not isinstance(device.get("id"), str)
            ):
                raise PodwaffleApiError("Podwaffle returned an invalid join response")
            profile_name = (
                returned_profile.get("displayName")
                if isinstance(returned_profile, dict)
                else profile.get("displayName")
            )
            joined.append(
                {
                    "profile_id": profile_id,
                    "profile_name": str(profile_name),
                    "device_id": str(device["id"]),
                    "token": token,
                }
            )
        if not joined:
            raise PodwaffleApiError("No Podwaffle profiles were selected")
        return joined


def _normalize_url(value: str) -> str:
    value = value.strip().rstrip("/")
    split = urlsplit(value)
    if split.scheme not in {"http", "https"} or not split.netloc:
        raise ValueError("Invalid Podwaffle URL")
    return urlunsplit((split.scheme, split.netloc, split.path.rstrip("/"), "", ""))

"""Constants for the Podwaffle integration."""

from datetime import timedelta
from typing import Final, TypedDict

from homeassistant.const import Platform

DOMAIN: Final = "podwaffle"
INTEGRATION_VERSION: Final = "0.2.2"

CONF_BASE_URL: Final = "base_url"
CONF_JOIN_CODE: Final = "join_code"
CONF_PROFILE_IDS: Final = "profile_ids"
CONF_PROFILES: Final = "profiles"
CONF_VERIFY_SSL: Final = "verify_ssl"

PLATFORMS: Final = [Platform.MEDIA_PLAYER, Platform.SENSOR]
UPDATE_INTERVAL: Final = timedelta(seconds=60)
STATS_INTERVAL: Final = timedelta(minutes=5)


class PodwaffleProfileConfig(TypedDict):
    """Persisted credentials for one Podwaffle profile."""

    profile_id: str
    profile_name: str
    device_id: str
    token: str

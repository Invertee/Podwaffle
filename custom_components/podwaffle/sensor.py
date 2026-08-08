"""Sensor entities for Podwaffle profiles."""

from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfTime
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import coordinators_for_entry
from .coordinator import PodwaffleCoordinator
from .entity import PodwaffleEntity

SENSORS: tuple[SensorEntityDescription, ...] = (
    SensorEntityDescription(
        key="queue_remaining",
        name="Queue remaining",
        icon="mdi:playlist-clock",
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        state_class=SensorStateClass.MEASUREMENT,
    ),
    SensorEntityDescription(
        key="queue_episodes",
        name="Queue episodes",
        icon="mdi:playlist-music",
        state_class=SensorStateClass.MEASUREMENT,
    ),
    SensorEntityDescription(
        key="listening_today",
        name="Listening today",
        icon="mdi:timer-music-outline",
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        state_class=SensorStateClass.MEASUREMENT,
    ),
    SensorEntityDescription(
        key="listening_30d",
        name="Listening 30 days",
        icon="mdi:calendar-clock",
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        state_class=SensorStateClass.MEASUREMENT,
    ),
    SensorEntityDescription(
        key="listening_all",
        name="Listening all time",
        icon="mdi:clock-outline",
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        state_class=SensorStateClass.MEASUREMENT,
    ),
    SensorEntityDescription(
        key="content_consumed_30d",
        name="Content consumed 30 days",
        icon="mdi:progress-clock",
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        state_class=SensorStateClass.MEASUREMENT,
        entity_registry_enabled_default=False,
    ),
    SensorEntityDescription(
        key="content_consumed_all",
        name="Content consumed all time",
        icon="mdi:progress-clock",
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        state_class=SensorStateClass.MEASUREMENT,
        entity_registry_enabled_default=False,
    ),
    SensorEntityDescription(
        key="skipped_forward_30d",
        name="Skipped forward 30 days",
        icon="mdi:fast-forward-30",
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        state_class=SensorStateClass.MEASUREMENT,
        entity_registry_enabled_default=False,
    ),
    SensorEntityDescription(
        key="skipped_forward_all",
        name="Skipped forward all time",
        icon="mdi:fast-forward",
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        state_class=SensorStateClass.MEASUREMENT,
        entity_registry_enabled_default=False,
    ),
    SensorEntityDescription(
        key="rewound_30d",
        name="Rewound 30 days",
        icon="mdi:rewind-10",
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        state_class=SensorStateClass.MEASUREMENT,
        entity_registry_enabled_default=False,
    ),
    SensorEntityDescription(
        key="rewound_all",
        name="Rewound all time",
        icon="mdi:rewind",
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        state_class=SensorStateClass.MEASUREMENT,
        entity_registry_enabled_default=False,
    ),
    SensorEntityDescription(
        key="episodes_completed_30d",
        name="Episodes completed 30 days",
        icon="mdi:check-circle-outline",
        state_class=SensorStateClass.MEASUREMENT,
        entity_registry_enabled_default=False,
    ),
    SensorEntityDescription(
        key="episodes_completed_all",
        name="Episodes completed all time",
        icon="mdi:check-circle",
        state_class=SensorStateClass.MEASUREMENT,
        entity_registry_enabled_default=False,
    ),
    SensorEntityDescription(
        key="active_listening_days_30d",
        name="Active listening days 30 days",
        icon="mdi:calendar-check-outline",
        native_unit_of_measurement="d",
        state_class=SensorStateClass.MEASUREMENT,
        entity_registry_enabled_default=False,
    ),
    SensorEntityDescription(
        key="active_listening_days_all",
        name="Active listening days all time",
        icon="mdi:calendar-check",
        native_unit_of_measurement="d",
        state_class=SensorStateClass.MEASUREMENT,
        entity_registry_enabled_default=False,
    ),
    SensorEntityDescription(
        key="current_streak",
        name="Current listening streak",
        icon="mdi:fire",
        native_unit_of_measurement="d",
        state_class=SensorStateClass.MEASUREMENT,
        entity_registry_enabled_default=False,
    ),
    SensorEntityDescription(
        key="longest_streak",
        name="Longest listening streak",
        icon="mdi:calendar-star",
        native_unit_of_measurement="d",
        state_class=SensorStateClass.MEASUREMENT,
        entity_registry_enabled_default=False,
    ),
    SensorEntityDescription(
        key="subscriptions",
        name="Subscriptions",
        icon="mdi:podcast",
        state_class=SensorStateClass.MEASUREMENT,
        entity_registry_enabled_default=False,
    ),
    SensorEntityDescription(
        key="history_entries",
        name="History entries",
        icon="mdi:history",
        state_class=SensorStateClass.MEASUREMENT,
        entity_registry_enabled_default=False,
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Podwaffle profile sensors."""
    async_add_entities(
        PodwaffleSensor(coordinator, description)
        for coordinator in coordinators_for_entry(hass, entry).values()
        for description in SENSORS
    )


class PodwaffleSensor(PodwaffleEntity, SensorEntity):
    """A statistic or queue measurement for one profile."""

    entity_description: SensorEntityDescription

    def __init__(
        self,
        coordinator: PodwaffleCoordinator,
        description: SensorEntityDescription,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self.entity_description = description
        self._attr_unique_id = f"{coordinator.profile_id}_{description.key}"

    @property
    def native_value(self) -> int | float | None:
        """Return the current sensor value."""
        key = self.entity_description.key
        if key == "queue_remaining":
            remaining, _unknown = _queue_remaining(self.coordinator.data.snapshot)
            return round(remaining / 1000)
        if key == "queue_episodes":
            queue = self.coordinator.data.snapshot.get("queue")
            return len(queue) if isinstance(queue, list) else 0
        if key == "listening_today":
            return _milliseconds_as_seconds(
                self.coordinator.data.stats_today.get("listenedMs")
            )
        if key == "listening_30d":
            return _milliseconds_as_seconds(
                self.coordinator.data.stats_30d.get("listenedMs")
            )
        if key == "listening_all":
            return _milliseconds_as_seconds(
                self.coordinator.data.stats_all.get("listenedMs")
            )
        if key == "content_consumed_30d":
            return _milliseconds_as_seconds(
                self.coordinator.data.stats_30d.get("contentConsumedMs")
            )
        if key == "content_consumed_all":
            return _milliseconds_as_seconds(
                self.coordinator.data.stats_all.get("contentConsumedMs")
            )
        if key == "skipped_forward_30d":
            return _milliseconds_as_seconds(
                self.coordinator.data.stats_30d.get("skippedForwardMs")
            )
        if key == "skipped_forward_all":
            return _milliseconds_as_seconds(
                self.coordinator.data.stats_all.get("skippedForwardMs")
            )
        if key == "rewound_30d":
            return _milliseconds_as_seconds(
                self.coordinator.data.stats_30d.get("rewoundMs")
            )
        if key == "rewound_all":
            return _milliseconds_as_seconds(
                self.coordinator.data.stats_all.get("rewoundMs")
            )
        if key == "episodes_completed_30d":
            return _number(self.coordinator.data.stats_30d.get("episodesCompleted"))
        if key == "episodes_completed_all":
            return _number(self.coordinator.data.stats_all.get("episodesCompleted"))
        if key == "active_listening_days_30d":
            return _number(self.coordinator.data.stats_30d.get("activeListeningDays"))
        if key == "active_listening_days_all":
            return _number(self.coordinator.data.stats_all.get("activeListeningDays"))
        if key == "current_streak":
            return _number(self.coordinator.data.stats_all.get("currentStreak"))
        if key == "longest_streak":
            return _number(self.coordinator.data.stats_all.get("longestStreak"))
        if key == "subscriptions":
            return _number(self.coordinator.data.stats_all.get("subscriptions"))
        if key == "history_entries":
            return _number(self.coordinator.data.stats_all.get("historyEntries"))
        return None

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        if self.entity_description.key != "queue_remaining":
            return None
        _remaining, unknown = _queue_remaining(self.coordinator.data.snapshot)
        return {"unknown_duration_episodes": unknown}


def _number(value: Any) -> int:
    return int(value) if isinstance(value, (int, float)) else 0


def _milliseconds_as_seconds(value: Any) -> int:
    return round(_number(value) / 1000)


def _queue_remaining(snapshot: dict[str, Any]) -> tuple[int, int]:
    queue = snapshot.get("queue")
    playback = snapshot.get("playback")
    if not isinstance(queue, list):
        return 0, 0
    playback = playback if isinstance(playback, dict) else {}
    active_episode = playback.get("episode")
    active_id = active_episode.get("id") if isinstance(active_episode, dict) else None
    position_ms = _number(playback.get("positionMs"))
    playback_duration = playback.get("durationMs")
    total = 0
    unknown = 0
    for item in queue:
        if not isinstance(item, dict):
            continue
        episode = item.get("episode")
        if not isinstance(episode, dict):
            continue
        duration = episode.get("durationMs")
        if episode.get("id") == active_id and isinstance(
            playback_duration, (int, float)
        ):
            duration = playback_duration
        if not isinstance(duration, (int, float)) or duration <= 0:
            unknown += 1
            continue
        total += (
            max(0, round(duration) - position_ms)
            if episode.get("id") == active_id
            else round(duration)
        )
    return total, unknown

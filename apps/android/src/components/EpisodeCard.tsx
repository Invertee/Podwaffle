import type { Episode } from "@podwaffle/contracts";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
} from "../styles/tokens";
import { DownloadAction } from "./DownloadAction";
import { Icon } from "./Icon";

export function formatDurationMs(durationMs: number | null): string {
  if (!durationMs || durationMs <= 0) return "Duration unavailable";
  const totalMinutes = Math.max(1, Math.round(durationMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0
    ? `${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`
    : `${minutes} min`;
}

function formatPublishedAt(value: string | null): string {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

export function EpisodeCard({
  episode,
  busy = false,
  showPodcast = true,
  onPlay,
  onTogglePlayed,
  onAddQueue,
}: {
  episode: Episode;
  busy?: boolean;
  showPodcast?: boolean;
  onPlay: (episode: Episode) => void | Promise<void>;
  onTogglePlayed: (episode: Episode) => void | Promise<void>;
  onAddQueue: (
    episode: Episode,
    position: "next" | "bottom",
  ) => void | Promise<void>;
}) {
  const progress =
    episode.durationMs && episode.durationMs > 0
      ? Math.max(0, Math.min(1, episode.positionMs / episode.durationMs))
      : 0;
  const resume = episode.positionMs > 0 && !episode.played;

  return (
    <View style={[styles.card, episode.played && styles.playedCard]}>
      <View style={styles.copy}>
        {showPodcast ? (
          <Text style={styles.podcastTitle} numberOfLines={1}>
            {episode.podcastTitle}
          </Text>
        ) : null}
        <Text
          style={[styles.title, episode.played && styles.playedTitle]}
          numberOfLines={2}
        >
          {episode.title}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta} numberOfLines={1}>
            {formatPublishedAt(episode.publishedAt)} · {formatDurationMs(episode.durationMs)}
          </Text>
          {resume ? (
            <Text style={styles.progressLabel}>{Math.round(progress * 100)}%</Text>
          ) : null}
        </View>
        {resume ? (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [
            styles.playAction,
            pressed && styles.pressed,
            (!episode.enclosureUrl || busy) && styles.disabled,
          ]}
          disabled={!episode.enclosureUrl || busy}
          onPress={() => void onPlay(episode)}
          accessibilityRole="button"
          accessibilityLabel={`${resume ? "Resume" : "Play"} ${episode.title}`}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.textOnAccent} />
          ) : (
            <Icon name="play" size={17} color={colors.textOnAccent} />
          )}
        </Pressable>
        <Action
          icon="queueNext"
          label={`Play ${episode.title} next`}
          disabled={busy}
          onPress={() => onAddQueue(episode, "next")}
        />
        <Action
          icon="queue"
          label={`Add ${episode.title} to queue`}
          disabled={busy}
          onPress={() => onAddQueue(episode, "bottom")}
        />
        <DownloadAction episode={episode} compact />
        <Action
          icon="check"
          label={`Mark ${episode.title} ${episode.played ? "unplayed" : "played"}`}
          disabled={busy}
          active={episode.played}
          onPress={() => onTogglePlayed(episode)}
        />
      </View>
    </View>
  );
}

function Action({
  icon,
  label,
  disabled,
  active = false,
  onPress,
}: {
  icon: "queueNext" | "queue" | "check";
  label: string;
  disabled: boolean;
  active?: boolean;
  onPress: () => void | Promise<void>;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.action,
        active && styles.actionActive,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
      disabled={disabled}
      onPress={() => void onPress()}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon
        name={icon}
        size={18}
        color={active ? colors.success : colors.textSecondary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.bgSurface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  playedCard: { opacity: 0.68 },
  copy: { gap: 3 },
  podcastTitle: {
    color: colors.accent,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
    lineHeight: 19,
  },
  playedTitle: { textDecorationLine: "line-through" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  meta: { flex: 1, color: colors.textSecondary, fontSize: fontSizes.xs },
  progressLabel: { color: colors.accent, fontSize: fontSizes.xs },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: colors.bgElevated,
  },
  progressFill: { height: "100%", backgroundColor: colors.accent },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  playAction: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
    backgroundColor: colors.accent,
  },
  action: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  actionActive: { borderColor: colors.success },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.4 },
});

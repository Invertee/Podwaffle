import type { Episode } from "@podwaffle/contracts";
import { Image } from "expo-image";
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

  return (
    <View style={[styles.card, episode.played && styles.playedCard]}>
      <View style={styles.headerRow}>
        <View style={styles.artworkFrame}>
          {episode.artworkUrl ? (
            <Image
              source={{ uri: episode.artworkUrl }}
              style={styles.artwork}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <Text style={styles.artworkFallback}>PW</Text>
          )}
        </View>
        <View style={styles.copy}>
          {showPodcast ? (
            <Text style={styles.podcastTitle} numberOfLines={1}>
              {episode.podcastTitle}
            </Text>
          ) : null}
          <Text
            style={[styles.title, episode.played && styles.playedTitle]}
            numberOfLines={3}
          >
            {episode.title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {formatPublishedAt(episode.publishedAt)} · {formatDurationMs(episode.durationMs)}
          </Text>
        </View>
      </View>

      {progress > 0 && !episode.played ? (
        <View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
          <Text style={styles.progressLabel}>
            {Math.round(progress * 100)}% played
          </Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [
            styles.primaryAction,
            pressed && styles.pressed,
            (!episode.enclosureUrl || busy) && styles.disabled,
          ]}
          disabled={!episode.enclosureUrl || busy}
          onPress={() => void onPlay(episode)}
          accessibilityRole="button"
          accessibilityLabel={`Play ${episode.title}`}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.textOnAccent} />
          ) : (
            <Text style={styles.primaryActionText}>
              {episode.positionMs > 0 && !episode.played ? "▶ Resume" : "▶ Play"}
            </Text>
          )}
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          disabled={busy}
          onPress={() => void onAddQueue(episode, "next")}
          accessibilityRole="button"
          accessibilityLabel={`Play ${episode.title} next`}
        >
          <Text style={styles.actionText}>Next</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          disabled={busy}
          onPress={() => void onAddQueue(episode, "bottom")}
          accessibilityRole="button"
          accessibilityLabel={`Add ${episode.title} to queue`}
        >
          <Text style={styles.actionText}>Queue</Text>
        </Pressable>

        <DownloadAction episode={episode} />

        <Pressable
          style={({ pressed }) => [
            styles.action,
            episode.played && styles.playedAction,
            pressed && styles.pressed,
          ]}
          disabled={busy}
          onPress={() => void onTogglePlayed(episode)}
          accessibilityRole="button"
          accessibilityLabel={`Mark ${episode.title} ${episode.played ? "unplayed" : "played"}`}
        >
          <Text
            style={[styles.actionText, episode.played && styles.playedActionText]}
          >
            {episode.played ? "Unplay" : "Played"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
    gap: spacing.md,
    backgroundColor: colors.bgSurface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  playedCard: { opacity: 0.72 },
  headerRow: { flexDirection: "row", gap: spacing.md },
  artworkFrame: {
    width: 72,
    height: 72,
    borderRadius: radii.md,
    overflow: "hidden",
    backgroundColor: colors.bgElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  artwork: { width: "100%", height: "100%" },
  artworkFallback: {
    color: colors.textMuted,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.bold,
  },
  copy: { flex: 1, gap: 4 },
  podcastTitle: {
    color: colors.accent,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
    lineHeight: 20,
  },
  playedTitle: { textDecorationLine: "line-through" },
  meta: { color: colors.textSecondary, fontSize: fontSizes.xs },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: colors.bgElevated,
  },
  progressFill: { height: "100%", backgroundColor: colors.accent },
  progressLabel: {
    marginTop: 5,
    color: colors.textMuted,
    fontSize: fontSizes.xs,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  primaryAction: {
    minHeight: 40,
    minWidth: 92,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
    backgroundColor: colors.accent,
  },
  primaryActionText: {
    color: colors.textOnAccent,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.bold,
  },
  action: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  actionText: {
    color: colors.textSecondary,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
  },
  playedAction: { borderColor: colors.success },
  playedActionText: { color: colors.success },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
});

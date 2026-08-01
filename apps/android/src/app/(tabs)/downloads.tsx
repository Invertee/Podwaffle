import { Image } from "expo-image";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { PodwaffleMediaModule, type NativeDownload } from "../../native-media";
import { playbackController } from "../../playback/controller";
import { useDownloadsStore } from "../../stores/downloads";
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
} from "../../styles/tokens";

function size(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "Size unavailable";
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export default function DownloadsScreen() {
  const items = useDownloadsStore((state) => state.items);
  const loading = useDownloadsStore((state) => state.loading);
  const error = useDownloadsStore((state) => state.error);
  const load = useDownloadsStore((state) => state.load);
  const [busyEpisodeId, setBusyEpisodeId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const active = items.some(
      (item) => item.state === "queued" || item.state === "downloading",
    );
    if (!active) return;
    const timer = setInterval(() => void load(), 2_000);
    return () => clearInterval(timer);
  }, [items, load]);

  async function manualRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  async function play(download: NativeDownload) {
    setBusyEpisodeId(download.episodeId);
    try {
      await playbackController.playDownloaded(download);
    } catch (playError) {
      Alert.alert(
        "Playback failed",
        playError instanceof Error
          ? playError.message
          : "The downloaded episode could not be played.",
      );
    } finally {
      setBusyEpisodeId(null);
    }
  }

  async function remove(download: NativeDownload) {
    setBusyEpisodeId(download.episodeId);
    try {
      await PodwaffleMediaModule.removeDownload(download.episodeId);
      useDownloadsStore.getState().remove(download.episodeId);
    } catch (removeError) {
      Alert.alert(
        "Remove failed",
        removeError instanceof Error
          ? removeError.message
          : "The download could not be removed.",
      );
    } finally {
      setBusyEpisodeId(null);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Downloads</Text>
          <Text style={styles.subtitle}>
            {items.filter((item) => item.state === "completed").length} ready offline
          </Text>
        </View>
        {loading && items.length === 0 ? (
          <ActivityIndicator color={colors.accent} />
        ) : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={items}
        keyExtractor={(item) => item.episodeId}
        contentContainerStyle={[
          styles.list,
          items.length === 0 && styles.emptyList,
        ]}
        onRefresh={() => void manualRefresh()}
        refreshing={refreshing}
        renderItem={({ item }) => {
          const progress =
            item.totalBytes && item.totalBytes > 0
              ? Math.min(1, item.progressBytes / item.totalBytes)
              : 0;
          const busy = busyEpisodeId === item.episodeId;
          return (
            <View style={styles.card}>
              <View style={styles.row}>
                <View style={styles.artworkFrame}>
                  {item.artworkUrl ? (
                    <Image
                      source={{ uri: item.artworkUrl }}
                      style={styles.artwork}
                      contentFit="cover"
                    />
                  ) : (
                    <Text style={styles.artworkFallback}>PW</Text>
                  )}
                </View>
                <View style={styles.copy}>
                  <Text style={styles.podcast} numberOfLines={1}>
                    {item.podcastTitle}
                  </Text>
                  <Text style={styles.episode} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={styles.meta}>
                    {item.state === "completed"
                      ? `${size(item.totalBytes)} · Offline`
                      : item.state === "failed"
                        ? item.failureReason ?? "Download failed"
                        : item.state === "downloading"
                          ? `${Math.round(progress * 100)}% · ${size(item.totalBytes)}`
                          : "Waiting to download"}
                  </Text>
                </View>
              </View>

              {item.state === "downloading" || item.state === "queued" ? (
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${Math.max(progress * 100, item.state === "queued" ? 3 : 0)}%` },
                    ]}
                  />
                </View>
              ) : null}

              <View style={styles.actions}>
                {item.state === "completed" ? (
                  <Pressable
                    style={({ pressed }) => [
                      styles.primary,
                      pressed && styles.pressed,
                    ]}
                    disabled={busy}
                    onPress={() => void play(item)}
                    accessibilityRole="button"
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color={colors.textOnAccent} />
                    ) : (
                      <Text style={styles.primaryText}>▶ Play offline</Text>
                    )}
                  </Pressable>
                ) : null}
                <Pressable
                  style={({ pressed }) => [
                    styles.secondary,
                    pressed && styles.pressed,
                  ]}
                  disabled={busy}
                  onPress={() => void remove(item)}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryText}>Remove</Text>
                </Pressable>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>⇩</Text>
            <Text style={styles.emptyTitle}>Nothing downloaded</Text>
            <Text style={styles.emptyBody}>
              Use Download on an episode to keep it available without a network
              connection.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  header: {
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSizes.xxl,
    fontWeight: fontWeights.bold,
  },
  subtitle: { color: colors.textSecondary, fontSize: fontSizes.sm, marginTop: 3 },
  error: { color: colors.error, paddingHorizontal: spacing.md },
  list: { padding: spacing.md, paddingTop: 0, paddingBottom: spacing.lg, gap: spacing.md },
  emptyList: { flexGrow: 1 },
  card: {
    padding: spacing.md,
    gap: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { flexDirection: "row", gap: spacing.md },
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
  artworkFallback: { color: colors.textMuted, fontWeight: fontWeights.bold },
  copy: { flex: 1, gap: 4 },
  podcast: { color: colors.accent, fontSize: fontSizes.xs },
  episode: {
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
  },
  meta: { color: colors.textSecondary, fontSize: fontSizes.xs },
  progressTrack: {
    height: 5,
    borderRadius: 3,
    overflow: "hidden",
    backgroundColor: colors.bgElevated,
  },
  progressFill: { height: "100%", backgroundColor: colors.accent },
  actions: { flexDirection: "row", gap: spacing.sm },
  primary: {
    minHeight: 42,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: {
    color: colors.textOnAccent,
    fontWeight: fontWeights.bold,
    fontSize: fontSizes.sm,
  },
  secondary: {
    minHeight: 42,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { color: colors.textSecondary, fontSize: fontSizes.sm },
  pressed: { opacity: 0.7 },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  emptyIcon: { color: colors.accent, fontSize: 54 },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.bold,
  },
  emptyBody: {
    maxWidth: 320,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
});

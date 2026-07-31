import type { QueueItem } from "@podwaffle/contracts";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Stack } from "expo-router";
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

import { api } from "../api/client";
import {
  authenticatedConnection,
  refreshProfile,
  withProfileRevision,
} from "../api/profileMutations";
import { formatDurationMs } from "../components/EpisodeCard";
import { playbackController } from "../playback/controller";
import { useAuthStore } from "../stores/auth";
import { useNativeMediaStore } from "../stores/nativeMedia";
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
} from "../styles/tokens";

export default function QueueScreen() {
  const credentials = useAuthStore((state) => state.credentials);
  const cachedQueue = useAuthStore((state) => state.snapshot?.queue ?? []);
  const currentEpisodeId = useNativeMediaStore(
    (state) => state.state?.episodeId ?? null,
  );
  const [orderedQueue, setOrderedQueue] = useState(cachedQueue);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  const queue = useQuery({
    queryKey: ["android-queue"],
    queryFn: () => api.queue(credentials!.serverUrl, credentials!.token),
    enabled: Boolean(credentials),
    initialData: cachedQueue,
  });

  useEffect(() => {
    setOrderedQueue(queue.data ?? []);
  }, [queue.data]);

  async function mutate(
    itemId: string,
    operation: (serverUrl: string, token: string, revision: number) => Promise<unknown>,
  ) {
    setBusyItemId(itemId);
    try {
      const { serverUrl, token } = authenticatedConnection();
      await withProfileRevision((revision) =>
        operation(serverUrl, token, revision),
      );
      await refreshProfile();
      await queue.refetch();
    } catch (error) {
      Alert.alert(
        "Queue update failed",
        error instanceof Error ? error.message : "The queue could not be updated.",
      );
    } finally {
      setBusyItemId(null);
    }
  }

  async function move(from: number, to: number) {
    if (from === to || busyItemId) return;
    const prior = orderedQueue;
    const next = [...orderedQueue];
    next.splice(to, 0, ...next.splice(from, 1));
    setOrderedQueue(next);
    try {
      const { serverUrl, token } = authenticatedConnection();
      setBusyItemId(next[to]?.id ?? "reorder");
      await withProfileRevision((revision) =>
        api.reorderQueue(
          serverUrl,
          token,
          next.map((item) => item.id),
          revision,
        ),
      );
      await refreshProfile();
      await queue.refetch();
    } catch (error) {
      setOrderedQueue(prior);
      Alert.alert(
        "Reorder failed",
        error instanceof Error ? error.message : "The queue order could not be saved.",
      );
    } finally {
      setBusyItemId(null);
    }
  }

  function confirmClear() {
    Alert.alert("Clear queue?", "All queued episodes will be removed.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () =>
          void mutate("clear", (serverUrl, token, revision) =>
            api.clearQueue(serverUrl, token, revision),
          ),
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: "Queue" }} />
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Coming up</Text>
          <Text style={styles.subtitle}>
            {orderedQueue.length} episode{orderedQueue.length === 1 ? "" : "s"}
          </Text>
        </View>
        {orderedQueue.length > 0 ? (
          <Pressable
            style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
            onPress={confirmClear}
            accessibilityRole="button"
          >
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>
        ) : null}
      </View>

      {queue.isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={orderedQueue}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.content,
            orderedQueue.length === 0 && styles.emptyContent,
          ]}
          refreshing={queue.isRefetching}
          onRefresh={() => void queue.refetch()}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item, index }) => {
            const active = currentEpisodeId === item.episode.id;
            const busy = busyItemId === item.id;
            return (
              <View style={[styles.item, active && styles.activeItem]}>
                <Text style={[styles.index, active && styles.activeText]}>
                  {active ? "▶" : index + 1}
                </Text>
                <View style={styles.artworkFrame}>
                  {item.episode.artworkUrl ? (
                    <Image
                      source={{ uri: item.episode.artworkUrl }}
                      style={styles.artwork}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                    />
                  ) : (
                    <Text style={styles.artworkFallback}>PW</Text>
                  )}
                </View>
                <View style={styles.copy}>
                  <Text style={styles.episodeTitle} numberOfLines={2}>
                    {item.episode.title}
                  </Text>
                  <Text style={styles.podcastTitle} numberOfLines={1}>
                    {item.episode.podcastTitle} · {formatDurationMs(item.episode.durationMs)}
                  </Text>
                  <View style={styles.actions}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.playButton,
                        pressed && styles.pressed,
                        busy && styles.disabled,
                      ]}
                      disabled={busy || !item.episode.enclosureUrl}
                      onPress={() =>
                        void playbackController.playEpisode(item.episode).catch((error) =>
                          Alert.alert(
                            "Playback failed",
                            error instanceof Error ? error.message : "The episode could not be played.",
                          ),
                        )
                      }
                      accessibilityRole="button"
                    >
                      <Text style={styles.playText}>{active ? "Resume" : "Play"}</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                      disabled={Boolean(busyItemId) || index === 0}
                      onPress={() => void move(index, index - 1)}
                      accessibilityRole="button"
                      accessibilityLabel={`Move ${item.episode.title} earlier`}
                    >
                      <Text style={styles.iconText}>↑</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                      disabled={Boolean(busyItemId) || index === orderedQueue.length - 1}
                      onPress={() => void move(index, index + 1)}
                      accessibilityRole="button"
                      accessibilityLabel={`Move ${item.episode.title} later`}
                    >
                      <Text style={styles.iconText}>↓</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
                      disabled={busy}
                      onPress={() =>
                        void mutate(item.id, (serverUrl, token, revision) =>
                          api.removeQueue(serverUrl, token, item.id, revision),
                        )
                      }
                      accessibilityRole="button"
                    >
                      {busy ? (
                        <ActivityIndicator size="small" color={colors.error} />
                      ) : (
                        <Text style={styles.removeText}>Remove</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptySymbol}>☷</Text>
              <Text style={styles.emptyTitle}>Queue is empty</Text>
              <Text style={styles.emptyBody}>
                Add episodes from a podcast or the In Progress screen.
              </Text>
            </View>
          }
        />
      )}
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
  clearButton: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
  },
  clearText: { color: colors.error, fontSize: fontSizes.sm, fontWeight: fontWeights.semibold },
  content: { padding: spacing.md, paddingTop: 0, paddingBottom: spacing.xl },
  emptyContent: { flexGrow: 1 },
  separator: { height: spacing.sm },
  item: {
    minHeight: 122,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSurface,
  },
  activeItem: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  index: {
    width: 24,
    color: colors.textMuted,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.bold,
    textAlign: "center",
    paddingTop: spacing.sm,
  },
  activeText: { color: colors.accent },
  artworkFrame: {
    width: 66,
    height: 66,
    borderRadius: radii.md,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgElevated,
  },
  artwork: { width: "100%", height: "100%" },
  artworkFallback: { color: colors.textMuted, fontSize: fontSizes.md, fontWeight: fontWeights.bold },
  copy: { flex: 1, gap: 4 },
  episodeTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    lineHeight: 18,
  },
  podcastTitle: { color: colors.textSecondary, fontSize: fontSizes.xs },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs },
  playButton: {
    minHeight: 34,
    minWidth: 62,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
    backgroundColor: colors.accent,
  },
  playText: { color: colors.textOnAccent, fontSize: fontSizes.xs, fontWeight: fontWeights.bold },
  iconButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
    backgroundColor: colors.bgElevated,
  },
  iconText: { color: colors.textPrimary, fontSize: fontSizes.md },
  removeButton: {
    minHeight: 34,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
  },
  removeText: { color: colors.error, fontSize: fontSizes.xs },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
  emptySymbol: { color: colors.accent, fontSize: 64 },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.bold,
  },
  emptyBody: {
    color: colors.textSecondary,
    fontSize: fontSizes.md,
    lineHeight: 22,
    textAlign: "center",
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
});

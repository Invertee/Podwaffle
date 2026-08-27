import type { QueueItem } from "@podwaffle/contracts";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ApiClientError, api } from "../api/client";
import {
  authenticatedConnection,
  refreshProfile,
  withProfileRevision,
} from "../api/profileMutations";
import { formatDurationMs } from "../components/EpisodeCard";
import { Icon } from "../components/Icon";
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
  const router = useRouter();
  const credentials = useAuthStore((state) => state.credentials);
  const cachedQueue = useAuthStore((state) => state.snapshot?.queue ?? []);
  const nativePlayback = useNativeMediaStore((state) => state.state);
  const currentEpisodeId = nativePlayback?.episodeId ?? null;
  const [orderedQueue, setOrderedQueue] = useState(cachedQueue);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const operationInFlight = useRef(false);

  const queue = useQuery({
    queryKey: ["android-queue"],
    queryFn: () => api.queue(credentials!.serverUrl, credentials!.token),
    enabled: Boolean(credentials),
    initialData: cachedQueue,
  });

  useEffect(() => {
    setOrderedQueue(queue.data ?? []);
  }, [queue.data]);

  const durationSummary = useMemo(
    () => summarizeQueueDuration(orderedQueue, nativePlayback),
    [
      orderedQueue,
      nativePlayback?.episodeId,
      nativePlayback?.positionMs,
      nativePlayback?.durationMs,
    ],
  );

  async function manualRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await queue.refetch();
    } finally {
      setRefreshing(false);
    }
  }

  async function mutate(
    itemId: string,
    operation: (
      serverUrl: string,
      token: string,
      revision: number,
    ) => Promise<unknown>,
    ignoreMissing = false,
  ) {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setBusyItemId(itemId);
    try {
      const { serverUrl, token } = authenticatedConnection();
      await withProfileRevision((revision) =>
        operation(serverUrl, token, revision),
      );
      await refreshProfile();
      await queue.refetch();
    } catch (error) {
      if (
        ignoreMissing &&
        error instanceof ApiClientError &&
        error.status === 404
      ) {
        // A rapid second tap or a live queue update can make the local row stale
        // after the first removal has already succeeded. Treat that as the desired
        // final state and reconcile instead of showing an error.
        await refreshProfile().catch(() => undefined);
        await queue.refetch().catch(() => undefined);
        return;
      }
      Alert.alert(
        "Queue update failed",
        error instanceof Error
          ? error.message
          : "The queue could not be updated.",
      );
    } finally {
      operationInFlight.current = false;
      setBusyItemId(null);
    }
  }

  async function move(from: number, to: number) {
    if (from === to || busyItemId || operationInFlight.current) return;
    operationInFlight.current = true;
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
        error instanceof Error
          ? error.message
          : "The queue order could not be saved.",
      );
    } finally {
      operationInFlight.current = false;
      setBusyItemId(null);
    }
  }

  function confirmClear() {
    const clearsCurrent = orderedQueue.some(
      (item) => item.episode.id === currentEpisodeId,
    );
    Alert.alert(
      "Clear queue?",
      clearsCurrent
        ? "All episodes will be removed and playback will stop."
        : "All queued episodes will be removed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () =>
            void mutate("clear", async (serverUrl, token, revision) => {
              if (clearsCurrent) {
                await playbackController.clearPlayerForQueueRemoval();
              }
              return api.clearQueue(serverUrl, token, revision);
            }),
        },
      ],
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.pressed,
          ]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Icon name="back" size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Queue</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {orderedQueue.length} episode{orderedQueue.length === 1 ? "" : "s"}
            {` · ${durationSummary}`}
          </Text>
        </View>
        {orderedQueue.length > 0 ? (
          <Pressable
            style={({ pressed }) => [
              styles.clearButton,
              pressed && styles.pressed,
              Boolean(busyItemId) && styles.disabled,
            ]}
            disabled={Boolean(busyItemId)}
            onPress={confirmClear}
            accessibilityRole="button"
            accessibilityLabel="Clear queue"
          >
            <Icon name="trash" size={18} color={colors.error} />
          </Pressable>
        ) : (
          <View style={styles.headerSpacer} />
        )}
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
          refreshing={refreshing}
          onRefresh={() => void manualRefresh()}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item, index }) => (
            <QueueRow
              item={item}
              index={index}
              count={orderedQueue.length}
              active={currentEpisodeId === item.episode.id}
              busy={busyItemId === item.id}
              anyBusy={Boolean(busyItemId)}
              onMove={(to) => void move(index, to)}
              onRemove={() =>
                void mutate(
                  item.id,
                  async (serverUrl, token, revision) => {
                    if (currentEpisodeId === item.episode.id) {
                      await playbackController.clearPlayerForQueueRemoval();
                    }
                    return api.removeQueue(serverUrl, token, item.id, revision);
                  },
                  true,
                )
              }
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Icon name="queue" size={56} color={colors.accent} />
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

function summarizeQueueDuration(
  items: QueueItem[],
  playback: {
    episodeId: string | null;
    positionMs: number;
    durationMs: number | null;
  } | null,
): string {
  if (items.length === 0) return "0 min remaining";
  let totalMs = 0;
  let unknownDurations = 0;

  for (const item of items) {
    const active = item.episode.id === playback?.episodeId;
    const durationMs = active
      ? (playback.durationMs ?? item.episode.durationMs)
      : item.episode.durationMs;
    if (!durationMs || durationMs <= 0) {
      unknownDurations += 1;
      continue;
    }
    totalMs += active
      ? Math.max(0, durationMs - playback.positionMs)
      : durationMs;
  }

  if (totalMs <= 0 && unknownDurations > 0) {
    return unknownDurations === 1
      ? "duration unknown"
      : `${unknownDurations} durations unknown`;
  }
  const known = `${formatDurationMs(totalMs)} remaining`;
  return unknownDurations > 0
    ? `${known} · ${unknownDurations} unknown`
    : known;
}

function QueueRow({
  item,
  index,
  count,
  active,
  busy,
  anyBusy,
  onMove,
  onRemove,
}: {
  item: QueueItem;
  index: number;
  count: number;
  active: boolean;
  busy: boolean;
  anyBusy: boolean;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  return (
    <View style={[styles.item, active && styles.activeItem]}>
      <View style={[styles.index, active && styles.activeIndex]}>
        {active ? (
          <Icon name="play" size={15} color={colors.accent} />
        ) : (
          <Text style={styles.indexText}>{index + 1}</Text>
        )}
      </View>
      <View style={styles.copy}>
        <Text style={styles.episodeTitle} numberOfLines={2}>
          {item.episode.title}
        </Text>
        <Text style={styles.podcastTitle} numberOfLines={1}>
          {item.episode.podcastTitle}
          {item.episode.durationMs
            ? ` · ${formatDurationMs(item.episode.durationMs)}`
            : ""}
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [
            styles.primaryAction,
            pressed && styles.pressed,
            (busy || anyBusy) && styles.disabled,
          ]}
          disabled={anyBusy || !item.episode.enclosureUrl}
          onPress={() =>
            void playbackController
              .playEpisode(item.episode)
              .catch((error) =>
                Alert.alert(
                  "Playback failed",
                  error instanceof Error
                    ? error.message
                    : "The episode could not be played.",
                ),
              )
          }
          accessibilityRole="button"
          accessibilityLabel={`${active ? "Resume" : "Play"} ${item.episode.title}`}
        >
          <Icon name="play" size={17} color={colors.textOnAccent} />
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.iconButton,
            pressed && styles.pressed,
            (anyBusy || active || index === 0) && styles.disabled,
          ]}
          disabled={anyBusy || active || index === 0}
          onPress={() => onMove(index - 1)}
          accessibilityRole="button"
          accessibilityLabel={`Move ${item.episode.title} earlier`}
        >
          <Text style={styles.moveText}>↑</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.iconButton,
            pressed && styles.pressed,
            (anyBusy || active || index === count - 1) && styles.disabled,
          ]}
          disabled={anyBusy || active || index === count - 1}
          onPress={() => onMove(index + 1)}
          accessibilityRole="button"
          accessibilityLabel={`Move ${item.episode.title} later`}
        >
          <Text style={styles.moveText}>↓</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.iconButton,
            styles.removeButton,
            pressed && styles.pressed,
            anyBusy && styles.disabled,
          ]}
          disabled={anyBusy}
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${item.episode.title}${
            active ? " and stop playback" : ""
          }`}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.error} />
          ) : (
            <Icon name="trash" size={17} color={colors.error} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  header: {
    minHeight: 58,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  backButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
    backgroundColor: colors.bgSurface,
  },
  headerCopy: { flex: 1 },
  title: {
    color: colors.textPrimary,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.bold,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSizes.xs,
    marginTop: 2,
  },
  clearButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
  },
  headerSpacer: { width: 38 },
  content: { padding: spacing.md, paddingBottom: spacing.lg },
  emptyContent: { flexGrow: 1 },
  separator: { height: spacing.xs },
  item: {
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSurface,
  },
  activeItem: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  index: {
    width: 28,
    height: 28,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgElevated,
  },
  activeIndex: { backgroundColor: colors.accentDim },
  indexText: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
  },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  episodeTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    lineHeight: 17,
  },
  podcastTitle: { color: colors.textSecondary, fontSize: fontSizes.xs },
  actions: { flexDirection: "row", alignItems: "center", gap: 3 },
  primaryAction: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
    backgroundColor: colors.accent,
  },
  iconButton: {
    width: 31,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
    backgroundColor: colors.bgElevated,
  },
  removeButton: { backgroundColor: "rgba(239, 68, 68, 0.1)" },
  moveText: { color: colors.textPrimary, fontSize: fontSizes.md },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
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
  pressed: { opacity: 0.68 },
  disabled: { opacity: 0.42 },
});

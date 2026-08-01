import type { QueueItem } from "@podwaffle/contracts";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
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
  const currentEpisodeId = useNativeMediaStore(
    (state) => state.state?.episodeId ?? null,
  );
  const [orderedQueue, setOrderedQueue] = useState(cachedQueue);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const queue = useQuery({
    queryKey: ["android-queue"],
    queryFn: () => api.queue(credentials!.serverUrl, credentials!.token),
    enabled: Boolean(credentials),
    initialData: cachedQueue,
  });

  useEffect(() => {
    setOrderedQueue(queue.data ?? []);
  }, [queue.data]);

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
        error instanceof Error
          ? error.message
          : "The queue order could not be saved.",
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
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Icon name="back" size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Queue</Text>
          <Text style={styles.subtitle}>
            {orderedQueue.length} episode{orderedQueue.length === 1 ? "" : "s"}
          </Text>
        </View>
        {orderedQueue.length > 0 ? (
          <Pressable
            style={({ pressed }) => [
              styles.clearButton,
              pressed && styles.pressed,
            ]}
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
                void mutate(item.id, (serverUrl, token, revision) =>
                  api.removeQueue(serverUrl, token, item.id, revision),
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
            busy && styles.disabled,
          ]}
          disabled={busy || !item.episode.enclosureUrl}
          onPress={() =>
            void playbackController.playEpisode(item.episode).catch((error) =>
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
            (anyBusy || index === 0) && styles.disabled,
          ]}
          disabled={anyBusy || index === 0}
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
            (anyBusy || index === count - 1) && styles.disabled,
          ]}
          disabled={anyBusy || index === count - 1}
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
            busy && styles.disabled,
          ]}
          disabled={busy}
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${item.episode.title}`}
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
  subtitle: { color: colors.textSecondary, fontSize: fontSizes.xs, marginTop: 2 },
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

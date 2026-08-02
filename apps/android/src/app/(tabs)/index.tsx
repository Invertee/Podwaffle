import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Subscription } from "@podwaffle/contracts";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { api } from "../../api/client";
import {
  authenticatedConnection,
  refreshProfile,
  withProfileRevision,
} from "../../api/profileMutations";
import { Icon } from "../../components/Icon";
import { useCastAction } from "../../hooks/useCastAction";
import { useAuthStore } from "../../stores/auth";
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
} from "../../styles/tokens";

const LAYOUT_KEY_PREFIX = "podwaffle.library-layout.v2";
const REORDER_ROW_HEIGHT = 82;

function Artwork({ item, size }: { item: Subscription; size: number }) {
  return (
    <View style={[styles.artworkFrame, { width: size, height: size }]}>
      {item.artworkUrl ? (
        <Image
          source={{ uri: item.artworkUrl }}
          style={styles.artwork}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : (
        <Text style={styles.artworkFallback}>PW</Text>
      )}
      {item.hasNewEpisode ? (
        <View style={styles.newDot} accessibilityLabel="Has new episodes" />
      ) : null}
    </View>
  );
}

function ReorderRow({
  item,
  index,
  count,
  disabled,
  onMove,
}: {
  item: Subscription;
  index: number;
  count: number;
  disabled: boolean;
  onMove: (from: number, to: number) => void;
}) {
  const translateY = useRef(new Animated.Value(0)).current;
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          !disabled && Math.abs(gesture.dy) > 4,
        onPanResponderMove: (_event, gesture) => {
          translateY.setValue(gesture.dy);
        },
        onPanResponderRelease: (_event, gesture) => {
          const offset = Math.round(gesture.dy / REORDER_ROW_HEIGHT);
          const target = Math.max(0, Math.min(count - 1, index + offset));
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
          if (target !== index) onMove(index, target);
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        },
      }),
    [count, disabled, index, onMove, translateY],
  );

  return (
    <Animated.View
      style={[styles.reorderRow, { transform: [{ translateY }] }]}
    >
      <View style={styles.dragHandle} {...panResponder.panHandlers}>
        <Text style={styles.dragHandleText}>☰</Text>
      </View>
      <Artwork item={item} size={54} />
      <View style={styles.reorderCopy}>
        <Text style={styles.listTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.author} numberOfLines={1}>
          {item.author ?? "Unknown author"}
        </Text>
      </View>
      <View style={styles.reorderButtons}>
        <Pressable
          style={({ pressed }) => [
            styles.moveButton,
            pressed && styles.pressed,
            (disabled || index === 0) && styles.disabled,
          ]}
          disabled={disabled || index === 0}
          onPress={() => onMove(index, index - 1)}
          accessibilityRole="button"
          accessibilityLabel={`Move ${item.title} earlier`}
        >
          <Text style={styles.moveButtonText}>↑</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.moveButton,
            pressed && styles.pressed,
            (disabled || index === count - 1) && styles.disabled,
          ]}
          disabled={disabled || index === count - 1}
          onPress={() => onMove(index, index + 1)}
          accessibilityRole="button"
          accessibilityLabel={`Move ${item.title} later`}
        >
          <Text style={styles.moveButtonText}>↓</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

export default function PodcastsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const profileId = useAuthStore((state) => state.snapshot?.profile.id);
  const snapshotSubscriptions = useAuthStore(
    (state) => state.snapshot?.subscriptions ?? [],
  );
  const queueCount = useAuthStore((state) => state.snapshot?.queue.length ?? 0);
  const connection = useAuthStore((state) => state.connection);
  const refresh = useAuthStore((state) => state.refresh);
  const { cast, castStatus, toggleCast } = useCastAction();
  const [mode, setMode] = useState<"tiles" | "list">("tiles");
  const [reordering, setReordering] = useState(false);
  const [reorderBusy, setReorderBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [subscriptions, setSubscriptions] = useState(snapshotSubscriptions);
  const columns = width >= 720 ? 5 : width >= 480 ? 4 : 3;
  const tileSize =
    (width - spacing.md * 2 - spacing.sm * (columns - 1)) / columns;
  const castBusy = castStatus === "connecting" || castStatus === "stopping";

  useEffect(() => {
    setSubscriptions(snapshotSubscriptions);
  }, [snapshotSubscriptions]);

  useEffect(() => {
    if (!profileId) return;
    void AsyncStorage.getItem(`${LAYOUT_KEY_PREFIX}:${profileId}`).then((saved) => {
      if (saved === "list" || saved === "tiles") setMode(saved);
    });
  }, [profileId]);

  function selectMode(next: "tiles" | "list") {
    setMode(next);
    if (profileId) {
      void AsyncStorage.setItem(`${LAYOUT_KEY_PREFIX}:${profileId}`, next);
    }
  }

  function openPodcast(item: Subscription) {
    router.push(
      {
        pathname: "/podcast/[podcastId]",
        params: { podcastId: item.id },
      } as never,
    );
  }

  async function changeCast() {
    try {
      await toggleCast();
    } catch (error) {
      Alert.alert(
        "Google Cast",
        error instanceof Error ? error.message : "Cast could not be changed.",
      );
    }
  }

  async function movePodcast(from: number, to: number) {
    if (reorderBusy || from === to) return;
    const prior = subscriptions;
    const next = [...subscriptions];
    next.splice(to, 0, ...next.splice(from, 1));
    setSubscriptions(next);
    setReorderBusy(true);
    try {
      const { serverUrl, token } = authenticatedConnection();
      await withProfileRevision((revision) =>
        api.reorderSubscriptions(
          serverUrl,
          token,
          next.map((item) => item.id),
          revision,
        ),
      );
      await refreshProfile();
    } catch (error) {
      setSubscriptions(prior);
      Alert.alert(
        "Reorder failed",
        error instanceof Error
          ? error.message
          : "The podcast order could not be saved.",
      );
    } finally {
      setReorderBusy(false);
    }
  }

  async function manualRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <View style={styles.container}>
      {connection !== "online" ? (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>
            {connection === "checking"
              ? "Checking for updates…"
              : "Offline — showing saved library"}
          </Text>
        </View>
      ) : null}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>My Podcasts</Text>
          <Text style={styles.count}>
            {subscriptions.length} subscription
            {subscriptions.length === 1 ? "" : "s"}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={({ pressed }) => [
              styles.castButton,
              cast.connected && styles.castButtonActive,
              castBusy && styles.disabled,
              pressed && !castBusy && styles.pressed,
            ]}
            disabled={castBusy}
            onPress={() => void changeCast()}
            accessibilityRole="button"
            accessibilityLabel={cast.connected ? "Stop casting" : "Cast"}
          >
            {castBusy ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Icon
                name="cast"
                size={20}
                color={cast.connected ? colors.accent : colors.textSecondary}
              />
            )}
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.queueButton, pressed && styles.pressed]}
            onPress={() => router.push("/queue" as never)}
            accessibilityRole="button"
            accessibilityLabel={`Open queue with ${queueCount} episodes`}
          >
            <Icon name="queue" size={17} color={colors.textSecondary} />
            <Text style={styles.queueButtonText}>{queueCount}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.reorderToggle,
              reordering && styles.reorderToggleActive,
              pressed && styles.pressed,
            ]}
            onPress={() => setReordering((value) => !value)}
            accessibilityRole="button"
            accessibilityState={{ selected: reordering }}
          >
            <Text
              style={[
                styles.reorderToggleText,
                reordering && styles.reorderToggleTextActive,
              ]}
            >
              {reordering ? "Done" : "Reorder"}
            </Text>
          </Pressable>
          {!reordering ? (
            <View style={styles.toggle}>
              {(["tiles", "list"] as const).map((value) => (
                <Pressable
                  key={value}
                  onPress={() => selectMode(value)}
                  style={[
                    styles.toggleButton,
                    mode === value && styles.toggleButtonActive,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: mode === value }}
                  accessibilityLabel={`${value === "tiles" ? "Tile" : "List"} view`}
                >
                  <Icon
                    name={value === "tiles" ? "tiles" : "list"}
                    size={20}
                    color={mode === value ? colors.accent : colors.textMuted}
                  />
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </View>

      {reordering ? (
        <FlatList
          data={subscriptions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          onRefresh={() => void manualRefresh()}
          refreshing={refreshing}
          renderItem={({ item, index }) => (
            <ReorderRow
              item={item}
              index={index}
              count={subscriptions.length}
              disabled={reorderBusy}
              onMove={(from, to) => void movePodcast(from, to)}
            />
          )}
          ListHeaderComponent={
            <Text style={styles.reorderHint}>
              Drag the handle, or use the arrow buttons, to set the complete
              podcast order.
            </Text>
          }
        />
      ) : (
        <FlatList
          key={`${mode}-${columns}`}
          data={subscriptions}
          keyExtractor={(item) => item.id}
          numColumns={mode === "tiles" ? columns : 1}
          columnWrapperStyle={mode === "tiles" ? styles.row : undefined}
          contentContainerStyle={[
            styles.listContent,
            subscriptions.length === 0 && styles.emptyContent,
          ]}
          onRefresh={() => void manualRefresh()}
          refreshing={refreshing}
          renderItem={({ item }) =>
            mode === "tiles" ? (
              <Pressable
                style={({ pressed }) => [
                  styles.tile,
                  { width: tileSize },
                  pressed && styles.pressed,
                ]}
                onPress={() => openPodcast(item)}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}${item.hasNewEpisode ? ", new episodes" : ""}`}
              >
                <Artwork item={item} size={tileSize} />
              </Pressable>
            ) : (
              <Pressable
                style={({ pressed }) => [
                  styles.listItem,
                  pressed && styles.pressed,
                ]}
                onPress={() => openPodcast(item)}
                accessibilityRole="button"
              >
                <Artwork item={item} size={64} />
                <View style={styles.listText}>
                  <Text style={styles.listTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={styles.author} numberOfLines={1}>
                    {item.author ?? "Unknown author"}
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            )
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Text style={styles.emptyIconText}>PW</Text>
              </View>
              <Text style={styles.emptyTitle}>Your library is ready</Text>
              <Text style={styles.emptyBody}>
                Open Discover to find and subscribe to a podcast.
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
  offlineBanner: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.skipDim,
  },
  offlineText: {
    color: colors.warning,
    textAlign: "center",
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
  },
  header: {
    padding: spacing.md,
    gap: spacing.md,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.xxl,
    fontWeight: fontWeights.bold,
  },
  count: { color: colors.textSecondary, fontSize: fontSizes.sm, marginTop: 2 },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  castButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  castButtonActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  queueButton: {
    minHeight: 40,
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.bgElevated,
  },
  queueButtonText: {
    color: colors.textSecondary,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
  },
  reorderToggle: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reorderToggleActive: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  reorderToggleText: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
  },
  reorderToggleTextActive: { color: colors.accent },
  toggle: {
    flexDirection: "row",
    padding: 2,
    borderRadius: radii.md,
    backgroundColor: colors.bgSurface,
  },
  toggleButton: {
    width: 42,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm,
  },
  toggleButtonActive: { backgroundColor: colors.accentDim },
  toggleText: { color: colors.textMuted, fontSize: 22 },
  toggleTextActive: { color: colors.accent },
  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
  emptyContent: { flexGrow: 1 },
  row: { gap: spacing.sm },
  tile: { marginBottom: spacing.sm },
  artworkFrame: {
    borderRadius: radii.md,
    overflow: "hidden",
    backgroundColor: colors.bgElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  artwork: { width: "100%", height: "100%" },
  artworkFallback: {
    color: colors.textMuted,
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.bold,
  },
  newDot: {
    position: "absolute",
    width: 13,
    height: 13,
    borderRadius: 7,
    right: 6,
    top: 6,
    backgroundColor: colors.newEpisodeDot,
    borderWidth: 2,
    borderColor: colors.bgPrimary,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  listText: { flex: 1 },
  listTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
  },
  author: { color: colors.textSecondary, fontSize: fontSizes.sm, marginTop: 3 },
  chevron: { color: colors.textMuted, fontSize: 30 },
  reorderHint: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    lineHeight: 19,
    paddingBottom: spacing.md,
  },
  reorderRow: {
    minHeight: REORDER_ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    backgroundColor: colors.bgPrimary,
    zIndex: 2,
  },
  dragHandle: {
    width: 34,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  dragHandleText: { color: colors.textMuted, fontSize: 24 },
  reorderCopy: { flex: 1 },
  reorderButtons: { flexDirection: "row", gap: spacing.xs },
  moveButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
    backgroundColor: colors.bgElevated,
  },
  moveButtonText: { color: colors.textPrimary, fontSize: fontSizes.lg },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: colors.bgElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyIconText: {
    color: colors.accent,
    fontSize: fontSizes.xxl,
    fontWeight: fontWeights.bold,
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
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.35 },
});

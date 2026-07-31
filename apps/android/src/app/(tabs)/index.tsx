import React, { useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Image } from "expo-image";
import type { Subscription } from "@podwaffle/contracts";

import { useAuthStore } from "../../stores/auth";
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
} from "../../styles/tokens";

function Artwork({ item, size }: { item: Subscription; size: number }) {
  return (
    <View style={[styles.artworkFrame, { width: size, height: size }]}>
      {item.artworkUrl ? (
        <Image
          source={{ uri: item.artworkUrl }}
          style={styles.artwork}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={150}
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

export default function PodcastsScreen() {
  const { width } = useWindowDimensions();
  const [mode, setMode] = useState<"tiles" | "list">("tiles");
  const snapshot = useAuthStore((state) => state.snapshot);
  const connection = useAuthStore((state) => state.connection);
  const refresh = useAuthStore((state) => state.refresh);
  const subscriptions = snapshot?.subscriptions ?? [];
  const columns = width >= 720 ? 5 : width >= 480 ? 4 : 3;
  const tileSize =
    (width - spacing.md * 2 - spacing.sm * (columns - 1)) / columns;

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
        <View style={styles.toggle}>
          {(["tiles", "list"] as const).map((value) => (
            <Pressable
              key={value}
              onPress={() => setMode(value)}
              style={[
                styles.toggleButton,
                mode === value && styles.toggleButtonActive,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === value }}
              accessibilityLabel={`${value === "tiles" ? "Tile" : "List"} view`}
            >
              <Text
                style={[
                  styles.toggleText,
                  mode === value && styles.toggleTextActive,
                ]}
              >
                {value === "tiles" ? "▦" : "☷"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

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
        onRefresh={() => void refresh()}
        refreshing={connection === "checking"}
        renderItem={({ item }) =>
          mode === "tiles" ? (
            <Pressable
              style={[styles.tile, { width: tileSize }]}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}${item.hasNewEpisode ? ", new episodes" : ""}`}
            >
              <Artwork item={item} size={tileSize} />
              <Text style={styles.tileTitle} numberOfLines={2}>
                {item.title}
              </Text>
            </Pressable>
          ) : (
            <Pressable style={styles.listItem} accessibilityRole="button">
              <Artwork item={item} size={64} />
              <View style={styles.listText}>
                <Text style={styles.listTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={styles.author} numberOfLines={1}>
                  {item.author ?? "Unknown author"}
                </Text>
              </View>
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
              Subscribe to a podcast from the web client, then pull down to sync
              it here.
            </Text>
          </View>
        }
      />
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.xxl,
    fontWeight: fontWeights.bold,
  },
  count: { color: colors.textSecondary, fontSize: fontSizes.sm, marginTop: 2 },
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
  listContent: { paddingHorizontal: spacing.md, paddingBottom: 150 },
  emptyContent: { flexGrow: 1 },
  row: { gap: spacing.sm },
  tile: { marginBottom: spacing.lg, gap: spacing.sm },
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
  tileTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    lineHeight: 17,
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
});

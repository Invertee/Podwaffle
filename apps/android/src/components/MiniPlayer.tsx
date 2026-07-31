import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  type GestureResponderEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { playbackController } from "../playback/controller";
import {
  selectHasMedia,
  selectIsPlaying,
  useNativeMediaStore,
} from "../stores/nativeMedia";
import {
  colors,
  fontSizes,
  fontWeights,
  MINI_PLAYER_HEIGHT,
  spacing,
} from "../styles/tokens";

export function MiniPlayer() {
  const router = useRouter();
  const mediaState = useNativeMediaStore((state) => state.state);
  const isPlaying = useNativeMediaStore(selectIsPlaying);
  const hasMedia = useNativeMediaStore(selectHasMedia);

  if (!hasMedia || !mediaState) return null;

  const isBuffering = mediaState.playbackStatus === "buffering";
  const progress =
    mediaState.durationMs && mediaState.durationMs > 0
      ? Math.max(0, Math.min(1, mediaState.positionMs / mediaState.durationMs))
      : 0;

  function control(
    event: GestureResponderEvent,
    operation: () => Promise<void>,
  ) {
    event.stopPropagation();
    void operation().catch((error) =>
      console.warn("[MiniPlayer] playback command failed:", error),
    );
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      onPress={() => router.push("/now-playing")}
      accessibilityRole="button"
      accessibilityLabel="Open now playing"
    >
      <View style={styles.content}>
        <View style={styles.artworkContainer}>
          {mediaState.artworkUrl ? (
            <Image
              source={{ uri: mediaState.artworkUrl }}
              style={styles.artwork}
              contentFit="cover"
              cachePolicy="memory-disk"
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View style={styles.artworkPlaceholder}>
              <Text style={styles.artworkFallback}>PW</Text>
            </View>
          )}
        </View>

        <View style={styles.titleContainer}>
          <Text style={styles.episodeTitle} numberOfLines={1}>
            {mediaState.title ?? "Unknown episode"}
          </Text>
          <Text style={styles.podcastTitle} numberOfLines={1}>
            {mediaState.podcastTitle ?? "Unknown podcast"}
          </Text>
        </View>

        <View style={styles.controls}>
          <Pressable
            onPress={(event) =>
              control(event, () => playbackController.skipBackward())
            }
            style={({ pressed }) => [
              styles.controlButton,
              pressed && styles.controlPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Skip backward"
            hitSlop={8}
          >
            <Text style={styles.iconText}>↶</Text>
          </Pressable>

          <Pressable
            onPress={(event) =>
              control(event, () =>
                isPlaying
                  ? playbackController.pause()
                  : playbackController.play(),
              )
            }
            style={({ pressed }) => [
              styles.controlButton,
              styles.playButton,
              pressed && styles.controlPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? "Pause" : "Play"}
            hitSlop={8}
          >
            {isBuffering ? (
              <ActivityIndicator size="small" color={colors.textOnAccent} />
            ) : (
              <Text style={styles.playIcon}>{isPlaying ? "Ⅱ" : "▶"}</Text>
            )}
          </Pressable>

          <Pressable
            onPress={(event) =>
              control(event, () => playbackController.skipForward())
            }
            style={({ pressed }) => [
              styles.controlButton,
              pressed && styles.controlPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Skip forward"
            hitSlop={8}
          >
            <Text style={styles.iconText}>↷</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    height: MINI_PLAYER_HEIGHT,
    backgroundColor: colors.playerBg,
    borderTopWidth: 1,
    borderTopColor: colors.playerBorder,
  },
  content: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  artworkContainer: { width: 48, height: 48 },
  artwork: { width: 48, height: 48, borderRadius: 6 },
  artworkPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 6,
    backgroundColor: colors.bgElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  artworkFallback: {
    color: colors.textMuted,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.bold,
  },
  titleContainer: { flex: 1, justifyContent: "center", overflow: "hidden" },
  episodeTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    lineHeight: 18,
  },
  podcastTitle: {
    color: colors.textSecondary,
    fontSize: fontSizes.xs,
    lineHeight: 16,
    marginTop: 2,
  },
  controls: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  controlButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
  },
  playButton: { backgroundColor: colors.accent },
  iconText: { color: colors.textPrimary, fontSize: 22 },
  playIcon: {
    color: colors.textOnAccent,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.bold,
  },
  progressTrack: { height: 3, backgroundColor: colors.bgElevated },
  progressFill: { height: "100%", backgroundColor: colors.accent },
  pressed: { opacity: 0.92 },
  controlPressed: { opacity: 0.65 },
});

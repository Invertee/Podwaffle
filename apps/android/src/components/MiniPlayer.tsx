import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
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
  const media = useNativeMediaStore((state) => state.state);
  const hasMedia = useNativeMediaStore(selectHasMedia);
  const isPlaying = useNativeMediaStore(selectIsPlaying);

  if (!hasMedia || !media) return null;

  const progress =
    media.durationMs && media.durationMs > 0
      ? Math.max(0, Math.min(1, media.positionMs / media.durationMs))
      : 0;

  return (
    <View style={styles.container}>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>
      <Pressable
        style={styles.openArea}
        onPress={() => router.push("/now-playing")}
        accessibilityRole="button"
        accessibilityLabel="Open now playing"
      >
        <View style={styles.artworkFrame}>
          {media.artworkUrl ? (
            <Image
              source={{ uri: media.artworkUrl }}
              style={styles.artwork}
              contentFit="cover"
            />
          ) : (
            <Text style={styles.artworkFallback}>PW</Text>
          )}
        </View>
        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={1}>
            {media.title ?? "Unknown episode"}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {media.source === "cast" && media.cast
              ? `Casting to ${media.cast.deviceName}`
              : media.source === "download"
                ? `${media.podcastTitle ?? "Podcast"} · Offline`
                : media.podcastTitle ?? "Unknown podcast"}
          </Text>
        </View>
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.control, pressed && styles.pressed]}
        onPress={() => void playbackController.skipBackward()}
        accessibilityRole="button"
        accessibilityLabel="Skip backward"
      >
        <Text style={styles.controlText}>↶</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [
          styles.control,
          styles.play,
          pressed && styles.pressed,
        ]}
        onPress={() =>
          void (isPlaying ? playbackController.pause() : playbackController.play())
        }
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? "Pause" : "Play"}
      >
        {media.playbackStatus === "buffering" ? (
          <ActivityIndicator size="small" color={colors.textOnAccent} />
        ) : (
          <Text style={styles.playText}>{isPlaying ? "Ⅱ" : "▶"}</Text>
        )}
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.control, pressed && styles.pressed]}
        onPress={() => void playbackController.skipForward()}
        accessibilityRole="button"
        accessibilityLabel="Skip forward"
      >
        <Text style={styles.controlText}>↷</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: MINI_PLAYER_HEIGHT,
    backgroundColor: colors.playerBg,
    borderTopWidth: 1,
    borderTopColor: colors.playerBorder,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  progressTrack: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.bgElevated,
  },
  progressFill: { height: 2, backgroundColor: colors.accent },
  openArea: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  artworkFrame: {
    width: 48,
    height: 48,
    borderRadius: 7,
    overflow: "hidden",
    backgroundColor: colors.bgElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  artwork: { width: "100%", height: "100%" },
  artworkFallback: { color: colors.textMuted, fontWeight: fontWeights.bold },
  copy: { flex: 1, minWidth: 0 },
  title: {
    color: colors.textPrimary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
  },
  subtitle: { color: colors.textSecondary, fontSize: fontSizes.xs, marginTop: 3 },
  control: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
  },
  play: { backgroundColor: colors.accent },
  controlText: { color: colors.textPrimary, fontSize: fontSizes.lg },
  playText: { color: colors.textOnAccent, fontWeight: fontWeights.bold },
  pressed: { opacity: 0.7 },
});

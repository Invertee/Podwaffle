import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React, { useRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { playbackController } from "../playback/controller";
import { useAuthStore } from "../stores/auth";
import {
  selectIsPlaying,
  useNativeMediaStore,
} from "../stores/nativeMedia";
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
} from "../styles/tokens";

const PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2, 2.5, 3];

function formatTime(ms: number | null): string {
  if (!ms || ms < 0 || !Number.isFinite(ms)) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
        .toString()
        .padStart(2, "0")}`
    : `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function NowPlayingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const state = useNativeMediaStore((store) => store.state);
  const isPlaying = useNativeMediaStore(selectIsPlaying);
  const skipBackwardSeconds = useAuthStore(
    (store) => store.skipBackwardSeconds,
  );
  const skipForwardSeconds = useAuthStore((store) => store.skipForwardSeconds);
  const progressWidth = useRef(1);

  if (!state?.episodeId) {
    return (
      <View style={[styles.empty, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.emptyArtwork}>
          <Text style={styles.emptyArtworkText}>PW</Text>
        </View>
        <Text style={styles.emptyTitle}>Nothing is playing</Text>
        <Text style={styles.emptyBody}>
          Choose an episode from a podcast or the In Progress screen.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
          onPress={() => router.back()}
          accessibilityRole="button"
        >
          <Text style={styles.closeButtonText}>Back to podcasts</Text>
        </Pressable>
      </View>
    );
  }

  const mediaState = state;
  const progress =
    mediaState.durationMs && mediaState.durationMs > 0
      ? Math.max(0, Math.min(1, mediaState.positionMs / mediaState.durationMs))
      : 0;
  const isBuffering = mediaState.playbackStatus === "buffering";

  function seekFromPress(locationX: number) {
    if (!mediaState.durationMs || mediaState.durationMs <= 0) return;
    const fraction = Math.max(0, Math.min(1, locationX / progressWidth.current));
    void playbackController.seekTo(Math.round(mediaState.durationMs * fraction));
  }

  function cycleRate() {
    const currentIndex = PLAYBACK_RATES.findIndex(
      (rate) => Math.abs(rate - mediaState.playbackRate) < 0.01,
    );
    const nextRate = PLAYBACK_RATES[(currentIndex + 1) % PLAYBACK_RATES.length] ?? 1;
    void playbackController.setPlaybackRate(nextRate);
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + spacing.xl },
      ]}
    >
      <View style={styles.artworkFrame}>
        {mediaState.artworkUrl ? (
          <Image
            source={{ uri: mediaState.artworkUrl }}
            style={styles.artwork}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : (
          <Text style={styles.artworkFallback}>PW</Text>
        )}
      </View>

      <View style={styles.metadata}>
        <Text style={styles.title}>{mediaState.title ?? "Unknown episode"}</Text>
        <Text style={styles.podcastTitle}>
          {mediaState.podcastTitle ?? "Unknown podcast"}
        </Text>
      </View>

      <View style={styles.timeline}>
        <Pressable
          style={styles.progressTouchTarget}
          onLayout={(event) => {
            progressWidth.current = Math.max(1, event.nativeEvent.layout.width);
          }}
          onPress={(event) => seekFromPress(event.nativeEvent.locationX)}
          accessibilityRole="adjustable"
          accessibilityLabel="Playback position"
          accessibilityValue={{
            min: 0,
            max: mediaState.durationMs ?? 0,
            now: mediaState.positionMs,
            text: `${formatTime(mediaState.positionMs)} of ${formatTime(mediaState.durationMs)}`,
          }}
        >
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.bufferedFill,
                {
                  width: `${
                    mediaState.durationMs && mediaState.durationMs > 0
                      ? Math.min(
                          100,
                          (mediaState.bufferedPositionMs / mediaState.durationMs) * 100,
                        )
                      : 0
                  }%`,
                },
              ]}
            />
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
        </Pressable>
        <View style={styles.timeRow}>
          <Text style={styles.time}>{formatTime(mediaState.positionMs)}</Text>
          <Text style={styles.time}>{formatTime(mediaState.durationMs)}</Text>
        </View>
      </View>

      <View style={styles.controls}>
        <Pressable
          style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}
          onPress={() => void playbackController.skipBackward()}
          accessibilityRole="button"
          accessibilityLabel={`Skip backward ${skipBackwardSeconds} seconds`}
        >
          <Text style={styles.skipSymbol}>↶</Text>
          <Text style={styles.skipSeconds}>{skipBackwardSeconds}</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.playButton, pressed && styles.pressed]}
          onPress={() =>
            void (isPlaying
              ? playbackController.pause()
              : playbackController.play())
          }
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? "Pause" : "Play"}
        >
          {isBuffering ? (
            <ActivityIndicator size="large" color={colors.textOnAccent} />
          ) : (
            <Text style={styles.playSymbol}>{isPlaying ? "Ⅱ" : "▶"}</Text>
          )}
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}
          onPress={() => void playbackController.skipForward()}
          accessibilityRole="button"
          accessibilityLabel={`Skip forward ${skipForwardSeconds} seconds`}
        >
          <Text style={styles.skipSymbol}>↷</Text>
          <Text style={styles.skipSeconds}>{skipForwardSeconds}</Text>
        </Pressable>
      </View>

      <View style={styles.secondaryControls}>
        <Pressable
          style={({ pressed }) => [styles.rateButton, pressed && styles.pressed]}
          onPress={cycleRate}
          accessibilityRole="button"
          accessibilityLabel={`Playback speed ${mediaState.playbackRate} times`}
        >
          <Text style={styles.rateText}>{mediaState.playbackRate}×</Text>
        </Pressable>
        <View style={styles.statusPill}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor:
                  mediaState.lastError !== null
                    ? colors.error
                    : isBuffering
                      ? colors.warning
                      : colors.success,
              },
            ]}
          />
          <Text style={styles.statusText}>
            {mediaState.lastError
              ? "Playback error"
              : isBuffering
                ? "Buffering"
                : isPlaying
                  ? "Playing on this device"
                  : "Paused"}
          </Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.stopButton, pressed && styles.pressed]}
          onPress={() => void playbackController.stop()}
          accessibilityRole="button"
          accessibilityLabel="Stop playback"
        >
          <Text style={styles.stopText}>Stop</Text>
        </Pressable>
      </View>

      {mediaState.lastError ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>{mediaState.lastError.code}</Text>
          <Text style={styles.errorBody}>{mediaState.lastError.message}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: {
    alignItems: "center",
    padding: spacing.lg,
    gap: spacing.lg,
  },
  artworkFrame: {
    width: "100%",
    maxWidth: 420,
    aspectRatio: 1,
    borderRadius: radii.xl,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgElevated,
  },
  artwork: { width: "100%", height: "100%" },
  artworkFallback: {
    color: colors.accent,
    fontSize: 72,
    fontWeight: fontWeights.bold,
  },
  metadata: { width: "100%", maxWidth: 520, gap: spacing.xs },
  title: {
    color: colors.textPrimary,
    fontSize: fontSizes.xxl,
    fontWeight: fontWeights.bold,
    lineHeight: 30,
    textAlign: "center",
  },
  podcastTitle: {
    color: colors.accent,
    fontSize: fontSizes.md,
    textAlign: "center",
  },
  timeline: { width: "100%", maxWidth: 520 },
  progressTouchTarget: { paddingVertical: spacing.md },
  progressTrack: {
    height: 7,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: colors.bgElevated,
  },
  bufferedFill: {
    position: "absolute",
    height: "100%",
    backgroundColor: colors.textMuted,
    opacity: 0.4,
  },
  progressFill: { height: "100%", backgroundColor: colors.accent },
  timeRow: { flexDirection: "row", justifyContent: "space-between" },
  time: { color: colors.textSecondary, fontSize: fontSizes.xs },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xl,
  },
  skipButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.skipDim,
  },
  skipSymbol: { color: colors.skip, fontSize: 30, lineHeight: 32 },
  skipSeconds: {
    position: "absolute",
    color: colors.skip,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
  },
  playButton: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  playSymbol: {
    color: colors.textOnAccent,
    fontSize: 34,
    fontWeight: fontWeights.bold,
  },
  secondaryControls: {
    width: "100%",
    maxWidth: 520,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  rateButton: {
    minWidth: 58,
    height: 40,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgElevated,
  },
  rateText: {
    color: colors.textPrimary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.bold,
  },
  statusPill: {
    flex: 1,
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    backgroundColor: colors.bgSurface,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: colors.textSecondary, fontSize: fontSizes.xs },
  stopButton: {
    minWidth: 58,
    height: 40,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(239, 68, 68, 0.12)",
  },
  stopText: { color: colors.error, fontSize: fontSizes.sm },
  errorCard: {
    width: "100%",
    maxWidth: 520,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
  },
  errorTitle: {
    color: colors.error,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.bold,
  },
  errorBody: { color: colors.textSecondary, fontSize: fontSizes.sm, marginTop: 4 },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.bgPrimary,
  },
  emptyArtwork: {
    width: 160,
    height: 160,
    borderRadius: radii.xl,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgElevated,
  },
  emptyArtworkText: {
    color: colors.accent,
    fontSize: 48,
    fontWeight: fontWeights.bold,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.xxl,
    fontWeight: fontWeights.bold,
  },
  emptyBody: {
    color: colors.textSecondary,
    fontSize: fontSizes.md,
    lineHeight: 22,
    textAlign: "center",
  },
  closeButton: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
    backgroundColor: colors.accent,
  },
  closeButtonText: {
    color: colors.textOnAccent,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.bold,
  },
  pressed: { opacity: 0.7 },
});

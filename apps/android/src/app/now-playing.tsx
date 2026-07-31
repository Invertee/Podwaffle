/**
 * Now Playing screen — the M14 feasibility spike screen.
 *
 * This screen binds to NativePlaybackState from Zustand and renders
 * real native media state and controls. It proves the React Native ↔ Kotlin
 * bridge works before full UI is implemented in Milestone 21.
 *
 * See spec §35.10
 */

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { PodwaffleMediaModule } from "../native-media/index";
import { useNativeMediaStore, selectIsPlaying } from "../stores/nativeMedia";
import {
  colors,
  spacing,
  fontSizes,
  fontWeights,
  radii,
} from "../styles/tokens";

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function ProgressBar({
  positionMs,
  durationMs,
}: {
  positionMs: number;
  durationMs: number | null;
}) {
  const progress = durationMs && durationMs > 0 ? positionMs / durationMs : 0;
  return (
    <View style={pbStyles.track}>
      <View style={[pbStyles.fill, { flex: progress }]} />
      <View style={{ flex: 1 - progress }} />
    </View>
  );
}

const pbStyles = StyleSheet.create({
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bgElevated,
    flexDirection: "row",
    overflow: "hidden",
  },
  fill: {
    backgroundColor: colors.accent,
  },
});

export default function NowPlayingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const mediaState = useNativeMediaStore((s) => s.state);
  const isPlaying = useNativeMediaStore(selectIsPlaying);

  async function handlePlayPause() {
    try {
      if (isPlaying) {
        await PodwaffleMediaModule.pause();
      } else {
        await PodwaffleMediaModule.play();
      }
    } catch (err) {
      console.warn("[NowPlaying] play/pause error:", err);
    }
  }

  async function handleSkipBackward() {
    try {
      await PodwaffleMediaModule.skipBackward();
    } catch (err) {
      console.warn("[NowPlaying] skip backward error:", err);
    }
  }

  async function handleSkipForward() {
    try {
      await PodwaffleMediaModule.skipForward();
    } catch (err) {
      console.warn("[NowPlaying] skip forward error:", err);
    }
  }

  const isBuffering = mediaState?.playbackStatus === "buffering";

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + spacing.xl },
      ]}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.headerLabel}>NOW PLAYING</Text>
        <View style={styles.closeBtn} />
      </View>

      {/* Artwork */}
      <View style={styles.artworkContainer}>
        {mediaState?.artworkUrl ? (
          <Image
            source={{ uri: mediaState.artworkUrl }}
            style={styles.artwork}
            contentFit="cover"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={styles.artworkPlaceholder}>
            <Text style={styles.artworkPlaceholderText}>🎙️</Text>
          </View>
        )}
      </View>

      {/* Titles */}
      <View style={styles.titles}>
        <Text style={styles.episodeTitle} numberOfLines={2}>
          {mediaState?.title ?? "Test Audio (Milestone 14)"}
        </Text>
        <Text style={styles.podcastTitle} numberOfLines={1}>
          {mediaState?.podcastTitle ?? "Podwaffle Native Spike"}
        </Text>
      </View>

      {/* Progress */}
      <View style={styles.progressSection}>
        <ProgressBar
          positionMs={mediaState?.positionMs ?? 0}
          durationMs={mediaState?.durationMs ?? null}
        />
        <View style={styles.timestamps}>
          <Text style={styles.timestamp}>
            {formatMs(mediaState?.positionMs ?? 0)}
          </Text>
          <Text style={styles.timestamp}>
            {mediaState?.durationMs
              ? `-${formatMs(mediaState.durationMs - mediaState.positionMs)}`
              : "--:--"}
          </Text>
        </View>
      </View>

      {/* Transport controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={styles.skipBtn}
          onPress={handleSkipBackward}
          accessibilityRole="button"
          accessibilityLabel="Skip backward"
        >
          <Text style={styles.skipText}>⏮</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.playBtn}
          onPress={handlePlayPause}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? "Pause" : "Play"}
        >
          {isBuffering ? (
            <ActivityIndicator size="large" color={colors.textOnAccent} />
          ) : (
            <Text style={styles.playText}>{isPlaying ? "⏸" : "▶"}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.skipBtn}
          onPress={handleSkipForward}
          accessibilityRole="button"
          accessibilityLabel="Skip forward"
        >
          <Text style={styles.skipText}>⏭</Text>
        </TouchableOpacity>
      </View>

      {/* Debug panel — shows raw native state in M14 for verification */}
      {__DEV__ && mediaState && (
        <View style={styles.debugPanel}>
          <Text style={styles.debugTitle}>Native State (dev only)</Text>
          <Text style={styles.debugText}>
            Status: {mediaState.playbackStatus}
          </Text>
          <Text style={styles.debugText}>
            PlayWhenReady: {String(mediaState.playWhenReady)}
          </Text>
          <Text style={styles.debugText}>Source: {mediaState.source}</Text>
          <Text style={styles.debugText}>
            Lease: {String(mediaState.hasLease)}
          </Text>
          <Text style={styles.debugText}>Rate: {mediaState.playbackRate}x</Text>
          <Text style={styles.debugText}>
            Queue: {mediaState.queueIndex + 1}/{mediaState.queueLength}
          </Text>
          {mediaState.lastError && (
            <Text style={[styles.debugText, styles.debugError]}>
              Error: {mediaState.lastError.code} —{" "}
              {mediaState.lastError.message}
            </Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  content: {
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.lg,
  },
  header: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  headerLabel: {
    color: colors.textSecondary,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
    letterSpacing: 1.5,
  },
  closeBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: {
    color: colors.textSecondary,
    fontSize: fontSizes.lg,
  },
  artworkContainer: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: radii.lg,
    overflow: "hidden",
    backgroundColor: colors.bgElevated,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  artwork: {
    width: "100%",
    height: "100%",
  },
  artworkPlaceholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  artworkPlaceholderText: {
    fontSize: 80,
  },
  titles: {
    width: "100%",
    gap: spacing.xs,
  },
  episodeTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.bold,
    lineHeight: 26,
  },
  podcastTitle: {
    color: colors.accent,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.medium,
  },
  progressSection: {
    width: "100%",
    gap: spacing.xs,
  },
  timestamps: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  timestamp: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
    fontVariant: ["tabular-nums"],
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xl,
    marginTop: spacing.sm,
  },
  skipBtn: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.skipDim,
    borderRadius: radii.full,
  },
  skipText: {
    fontSize: 24,
    color: colors.skip,
  },
  playBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  playText: {
    fontSize: 28,
    color: colors.textOnAccent,
  },
  debugPanel: {
    width: "100%",
    padding: spacing.md,
    backgroundColor: colors.bgElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  debugTitle: {
    color: colors.textSecondary,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  debugText: {
    color: colors.textSecondary,
    fontSize: fontSizes.xs,
    fontFamily: "monospace",
  },
  debugError: {
    color: colors.error,
  },
});

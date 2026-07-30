/**
 * Persistent mini-player shown above the bottom tab bar.
 *
 * Binds directly to native playback state — remains correct across navigation
 * and React Native reloads. See spec §35.9.
 */

import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";

import {
  useNativeMediaStore,
  selectIsPlaying,
  selectHasMedia,
} from "../stores/nativeMedia";
import { PodwaffleMediaModule } from "../native-media/index";
import {
  colors,
  spacing,
  fontSizes,
  fontWeights,
  MINI_PLAYER_HEIGHT,
} from "../styles/tokens";

// Simple icon components using Text to avoid extra deps in Milestone 14
function PlayIcon() {
  return <Text style={styles.iconText}>▶</Text>;
}
function PauseIcon() {
  return <Text style={styles.iconText}>⏸</Text>;
}
function SkipBackIcon() {
  return <Text style={styles.iconText}>⏮</Text>;
}
function SkipForwardIcon() {
  return <Text style={styles.iconText}>⏭</Text>;
}

export function MiniPlayer() {
  const router = useRouter();
  const mediaState = useNativeMediaStore((s) => s.state);
  const isPlaying = useNativeMediaStore(selectIsPlaying);
  const hasMedia = useNativeMediaStore(selectHasMedia);

  if (!hasMedia || !mediaState) {
    return null;
  }

  const isBuffering = mediaState.playbackStatus === "buffering";

  async function handlePlayPause() {
    try {
      if (isPlaying) {
        await PodwaffleMediaModule.pause();
      } else {
        await PodwaffleMediaModule.play();
      }
    } catch (err) {
      console.warn("[MiniPlayer] play/pause error:", err);
    }
  }

  async function handleSkipBackward() {
    try {
      await PodwaffleMediaModule.skipBackward();
    } catch (err) {
      console.warn("[MiniPlayer] skip backward error:", err);
    }
  }

  async function handleSkipForward() {
    try {
      await PodwaffleMediaModule.skipForward();
    } catch (err) {
      console.warn("[MiniPlayer] skip forward error:", err);
    }
  }

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => router.push("/now-playing")}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel="Open now playing"
    >
      {/* Artwork */}
      <View style={styles.artworkContainer}>
        {mediaState.artworkUrl ? (
          <Image
            source={{ uri: mediaState.artworkUrl }}
            style={styles.artwork}
            contentFit="cover"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={styles.artworkPlaceholder} />
        )}
      </View>

      {/* Titles */}
      <View style={styles.titleContainer}>
        <Text style={styles.episodeTitle} numberOfLines={1}>
          {mediaState.title ?? "Unknown episode"}
        </Text>
        <Text style={styles.podcastTitle} numberOfLines={1}>
          {mediaState.podcastTitle ?? "Unknown podcast"}
        </Text>
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          onPress={handleSkipBackward}
          style={styles.controlBtn}
          accessibilityRole="button"
          accessibilityLabel="Skip backward"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <SkipBackIcon />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handlePlayPause}
          style={[styles.controlBtn, styles.playBtn]}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? "Pause" : "Play"}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {isBuffering ? (
            <ActivityIndicator size="small" color={colors.textOnAccent} />
          ) : isPlaying ? (
            <PauseIcon />
          ) : (
            <PlayIcon />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleSkipForward}
          style={styles.controlBtn}
          accessibilityRole="button"
          accessibilityLabel="Skip forward"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <SkipForwardIcon />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
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
  artworkContainer: {
    width: 48,
    height: 48,
  },
  artwork: {
    width: 48,
    height: 48,
    borderRadius: 6,
  },
  artworkPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 6,
    backgroundColor: colors.bgElevated,
  },
  titleContainer: {
    flex: 1,
    justifyContent: "center",
    overflow: "hidden",
  },
  episodeTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    lineHeight: 18,
  },
  podcastTitle: {
    color: colors.textSecondary,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.normal,
    lineHeight: 16,
    marginTop: 2,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  controlBtn: {
    padding: spacing.xs,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 36,
    minHeight: 36,
  },
  playBtn: {
    backgroundColor: colors.accent,
    borderRadius: 18,
    width: 36,
    height: 36,
  },
  iconText: {
    color: colors.textPrimary,
    fontSize: fontSizes.md,
  },
});

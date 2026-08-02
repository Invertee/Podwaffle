import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import { playbackController } from "../playback/controller";
import { usePlaybackPresentation } from "../playback/presentation";
import { useAuthStore } from "../stores/auth";
import {
  colors,
  MINI_PLAYER_HEIGHT,
  radii,
  spacing,
} from "../styles/tokens";
import { Icon } from "./Icon";
import { PlaybackDeviceModal } from "./PlaybackDeviceModal";

export function MiniPlayer() {
  const router = useRouter();
  const playback = usePlaybackPresentation();
  const snapshot = useAuthStore((state) => state.snapshot);
  const media = playback.media;
  const enabled = playback.hasMedia;
  const [devicePickerOpen, setDevicePickerOpen] = useState(false);

  const activeEpisode =
    snapshot?.playback?.episode?.id === media?.episodeId
      ? snapshot.playback.episode
      : snapshot?.queue.find((item) => item.episode.id === media?.episodeId)?.episode;
  const artworkUrl =
    activeEpisode?.podcastArtworkUrl ?? media?.artworkUrl ?? activeEpisode?.artworkUrl ?? null;
  const progress =
    media?.durationMs && media.durationMs > 0
      ? Math.max(0, Math.min(1, media.positionMs / media.durationMs))
      : 0;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          enabled && gesture.dy < -8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderRelease: (_event, gesture) => {
          if (enabled && (gesture.dy < -28 || gesture.vy < -0.35)) {
            router.push("/now-playing");
          }
        },
      }),
    [enabled, router],
  );

  return (
    <>
      <View style={styles.container} {...panResponder.panHandlers}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>

        <View style={styles.sideSlot}>
          <Pressable
            style={({ pressed }) => [
              styles.artworkButton,
              !enabled && styles.disabled,
              pressed && enabled && styles.pressed,
            ]}
            disabled={!enabled}
            onPress={() => router.push("/now-playing")}
            accessibilityRole="button"
            accessibilityLabel={enabled ? "Open now playing" : "Nothing playing"}
          >
            {artworkUrl ? (
              <Image
                source={{ uri: artworkUrl }}
                style={styles.artwork}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : (
              <View style={styles.artworkFallback}>
                <Icon name="podcasts" size={22} color={colors.textMuted} />
              </View>
            )}
          </Pressable>
        </View>

        <View style={styles.controls}>
          <ChromeControl
            icon="previous"
            label="Skip backward"
            disabled={!enabled}
            onPress={() => playbackController.skipBackward()}
          />
          <Pressable
            style={({ pressed }) => [
              styles.control,
              styles.play,
              !enabled && styles.disabled,
              pressed && enabled && styles.pressed,
            ]}
            disabled={!enabled}
            onPress={() =>
              void (playback.isPlaying
                ? playbackController.pause()
                : playbackController.play())
            }
            accessibilityRole="button"
            accessibilityLabel={playback.isPlaying ? "Pause" : "Play"}
          >
            {media?.playbackStatus === "buffering" ? (
              <ActivityIndicator size="small" color={colors.textOnAccent} />
            ) : (
              <Icon
                name={playback.isPlaying ? "pause" : "play"}
                size={18}
                color={colors.textOnAccent}
              />
            )}
          </Pressable>
          <ChromeControl
            icon="next"
            label="Skip forward"
            disabled={!enabled}
            onPress={() => playbackController.skipForward()}
          />
        </View>

        <View style={styles.sideSlot}>
          {enabled ? (
            <Pressable
              style={({ pressed }) => [
                styles.transfer,
                playback.remote && styles.transferActive,
                pressed && styles.pressed,
              ]}
              onPress={() => setDevicePickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Choose playback device"
            >
              <Icon
                name="device"
                size={21}
                color={playback.remote ? colors.accent : colors.textSecondary}
              />
            </Pressable>
          ) : null}
        </View>
      </View>
      <PlaybackDeviceModal
        visible={devicePickerOpen}
        onClose={() => setDevicePickerOpen(false)}
      />
    </>
  );
}

function ChromeControl({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: "previous" | "next";
  label: string;
  disabled: boolean;
  onPress: () => void | Promise<void>;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.control,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
      disabled={disabled}
      onPress={() => void onPress()}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} size={22} color={colors.textPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    height: MINI_PLAYER_HEIGHT,
    backgroundColor: colors.playerBg,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
  },
  progressTrack: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.bgElevated,
  },
  progressFill: { height: 2, backgroundColor: colors.accent },
  sideSlot: {
    width: 56,
    height: MINI_PLAYER_HEIGHT - 2,
    alignItems: "center",
    justifyContent: "center",
  },
  artworkButton: {
    width: 50,
    height: 50,
    borderRadius: radii.md,
    overflow: "hidden",
    backgroundColor: colors.bgElevated,
  },
  artwork: { width: "100%", height: "100%" },
  artworkFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgElevated,
  },
  controls: {
    flex: 1,
    minWidth: 0,
    height: MINI_PLAYER_HEIGHT - 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  control: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
  },
  play: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent },
  transfer: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
    backgroundColor: colors.accentDim,
  },
  transferActive: { borderWidth: 1, borderColor: colors.accent },
  disabled: { opacity: 0.3 },
  pressed: { opacity: 0.65 },
});

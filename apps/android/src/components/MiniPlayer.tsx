import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { playbackController } from "../playback/controller";
import { usePlaybackPresentation } from "../playback/presentation";
import {
  colors,
  fontSizes,
  fontWeights,
  MINI_PLAYER_HEIGHT,
  spacing,
} from "../styles/tokens";
import { Icon } from "./Icon";
import { PlaybackDeviceModal } from "./PlaybackDeviceModal";

export function MiniPlayer() {
  const router = useRouter();
  const playback = usePlaybackPresentation();
  const media = playback.media;
  const enabled = playback.hasMedia;
  const [devicePickerOpen, setDevicePickerOpen] = useState(false);

  const progress =
    media?.durationMs && media.durationMs > 0
      ? Math.max(0, Math.min(1, media.positionMs / media.durationMs))
      : 0;

  return (
    <>
      <View style={styles.container}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <Pressable
          style={({ pressed }) => [
            styles.openArea,
            pressed && enabled && styles.pressed,
          ]}
          disabled={!enabled}
          onPress={() => router.push("/now-playing")}
          accessibilityRole="button"
          accessibilityLabel={enabled ? "Open now playing" : "Nothing playing"}
        >
          <View style={styles.copy}>
            <Text style={styles.title} numberOfLines={1}>
              {media?.title ?? "Nothing playing"}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {playback.remote
                ? `${media?.podcastTitle ?? "Podcast"} · playing on ${playback.ownerDeviceName}`
                : media?.source === "cast" && media.cast
                  ? `Casting to ${media.cast.deviceName}`
                  : media?.source === "download"
                    ? `${media.podcastTitle ?? "Podcast"} · Offline`
                    : media?.podcastTitle ?? "Choose an episode"}
            </Text>
          </View>
        </Pressable>

        <ChromeControl
          icon="rewind"
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
              size={17}
              color={colors.textOnAccent}
            />
          )}
        </Pressable>
        <ChromeControl
          icon="forward"
          label="Skip forward"
          disabled={!enabled}
          onPress={() => playbackController.skipForward()}
        />
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
              size={20}
              color={playback.remote ? colors.accent : colors.textSecondary}
            />
          </Pressable>
        ) : null}
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
  icon: "rewind" | "forward";
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
      <Icon name={icon} size={20} color={colors.textPrimary} />
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
    gap: 2,
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
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
  },
  copy: { minWidth: 0 },
  title: {
    color: colors.textPrimary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSizes.xs,
    marginTop: 2,
  },
  control: {
    width: 34,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
  },
  play: { width: 38, height: 38, backgroundColor: colors.accent },
  transfer: {
    width: 34,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: colors.accentDim,
  },
  transferActive: { backgroundColor: colors.accentDim },
  disabled: { opacity: 0.3 },
  pressed: { opacity: 0.65 },
});

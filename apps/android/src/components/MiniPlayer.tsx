import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Alert,
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
import { Icon } from "./Icon";

export function MiniPlayer() {
  const router = useRouter();
  const media = useNativeMediaStore((state) => state.state);
  const cast = useNativeMediaStore((state) => state.castState);
  const hasMedia = useNativeMediaStore(selectHasMedia);
  const isPlaying = useNativeMediaStore(selectIsPlaying);
  const enabled = Boolean(hasMedia && media);

  const progress =
    media?.durationMs && media.durationMs > 0
      ? Math.max(0, Math.min(1, media.positionMs / media.durationMs))
      : 0;

  async function toggleCast() {
    if (!enabled) return;
    try {
      if (cast.connected) await playbackController.stopCasting(true);
      else await playbackController.startCasting();
    } catch (error) {
      Alert.alert(
        "Google Cast",
        error instanceof Error ? error.message : "Cast could not be started.",
      );
    }
  }

  return (
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
        <View style={styles.artworkFrame}>
          {media?.artworkUrl ? (
            <Image
              source={{ uri: media.artworkUrl }}
              style={styles.artwork}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <Text style={styles.artworkFallback}>PW</Text>
          )}
        </View>
        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={1}>
            {media?.title ?? "Nothing playing"}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {media?.source === "cast" && media.cast
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
          void (isPlaying ? playbackController.pause() : playbackController.play())
        }
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? "Pause" : "Play"}
      >
        {media?.playbackStatus === "buffering" ? (
          <ActivityIndicator size="small" color={colors.textOnAccent} />
        ) : (
          <Icon
            name={isPlaying ? "pause" : "play"}
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
      <Pressable
        style={({ pressed }) => [
          styles.cast,
          cast.connected && styles.castActive,
          !enabled && styles.disabled,
          pressed && enabled && styles.pressed,
        ]}
        disabled={!enabled}
        onPress={() => void toggleCast()}
        accessibilityRole="button"
        accessibilityLabel={cast.connected ? "Stop casting" : "Cast"}
      >
        <Icon
          name="cast"
          size={20}
          color={cast.connected ? colors.accent : colors.textSecondary}
        />
      </Pressable>
    </View>
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
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  artworkFrame: {
    width: 44,
    height: 44,
    borderRadius: 7,
    overflow: "hidden",
    backgroundColor: colors.bgElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  artwork: { width: "100%", height: "100%" },
  artworkFallback: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
  },
  copy: { flex: 1, minWidth: 0 },
  title: {
    color: colors.textPrimary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
  },
  subtitle: { color: colors.textSecondary, fontSize: fontSizes.xs, marginTop: 2 },
  control: {
    width: 32,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
  },
  play: { width: 36, height: 36, backgroundColor: colors.accent },
  cast: {
    width: 32,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
  },
  castActive: { backgroundColor: colors.accentDim },
  disabled: { opacity: 0.3 },
  pressed: { opacity: 0.65 },
});

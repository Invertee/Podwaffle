import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "../api/client";
import { DownloadAction } from "../components/DownloadAction";
import { playbackController } from "../playback/controller";
import { useAuthStore } from "../stores/auth";
import { selectIsPlaying, useNativeMediaStore } from "../stores/nativeMedia";
import { usePlayerUiStore } from "../stores/playerUi";
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
} from "../styles/tokens";

function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1_000));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function SeekBar({
  positionMs,
  bufferedPositionMs,
  durationMs,
  onSeek,
}: {
  positionMs: number;
  bufferedPositionMs: number;
  durationMs: number | null;
  onSeek: (positionMs: number) => void;
}) {
  const [width, setWidth] = useState(1);
  const duration = durationMs ?? 0;
  const progress = duration > 0 ? Math.min(1, positionMs / duration) : 0;
  const buffered = duration > 0 ? Math.min(1, bufferedPositionMs / duration) : 0;

  function seekAt(locationX: number) {
    if (duration <= 0) return;
    onSeek(Math.round(Math.max(0, Math.min(1, locationX / width)) * duration));
  }

  return (
    <Pressable
      style={styles.seekTouch}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      onPress={(event) => seekAt(event.nativeEvent.locationX)}
      accessibilityRole="adjustable"
      accessibilityLabel="Playback position"
      accessibilityValue={{
        min: 0,
        max: Math.round(duration / 1_000),
        now: Math.round(positionMs / 1_000),
      }}
    >
      <View style={styles.seekTrack}>
        <View style={[styles.buffered, { width: `${buffered * 100}%` }]} />
        <View style={[styles.played, { width: `${progress * 100}%` }]} />
        <View style={[styles.thumb, { left: `${progress * 100}%` }]} />
      </View>
    </Pressable>
  );
}

export default function NowPlayingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const media = useNativeMediaStore((state) => state.state);
  const cast = useNativeMediaStore((state) => state.castState);
  const isPlaying = useNativeMediaStore(selectIsPlaying);
  const credentials = useAuthStore((state) => state.credentials);
  const backward = useAuthStore((state) => state.skipBackwardSeconds);
  const forward = useAuthStore((state) => state.skipForwardSeconds);
  const castStatus = usePlayerUiStore((state) => state.castStatus);
  const castError = usePlayerUiStore((state) => state.castError);
  const sleepTimerEndsAt = usePlayerUiStore((state) => state.sleepTimerEndsAt);
  const stopAtEpisodeEnd = usePlayerUiStore((state) => state.stopAtEpisodeEnd);
  const [clock, setClock] = useState(Date.now());

  const episode = useQuery({
    queryKey: ["android-now-playing-episode", media?.episodeId],
    queryFn: () =>
      api.episode(credentials!.serverUrl, credentials!.token, media!.episodeId!),
    enabled: Boolean(credentials && media?.episodeId),
  });

  useEffect(() => {
    if (!sleepTimerEndsAt) return;
    const timer = setInterval(() => setClock(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [sleepTimerEndsAt]);

  async function togglePlay() {
    try {
      if (isPlaying) await playbackController.pause();
      else await playbackController.play();
    } catch (error) {
      Alert.alert(
        "Playback failed",
        error instanceof Error ? error.message : "Playback could not be changed.",
      );
    }
  }

  function chooseSleepTimer() {
    Alert.alert("Sleep timer", "Pause playback after a delay.", [
      { text: "15 minutes", onPress: () => playbackController.setSleepTimer(15) },
      { text: "30 minutes", onPress: () => playbackController.setSleepTimer(30) },
      { text: "60 minutes", onPress: () => playbackController.setSleepTimer(60) },
      { text: "End of episode", onPress: () => playbackController.setSleepTimer("episode") },
      { text: "Off", style: "destructive", onPress: () => playbackController.setSleepTimer(null) },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  async function toggleCast() {
    try {
      if (cast.connected) await playbackController.stopCasting(true);
      else await playbackController.startCasting();
    } catch (error) {
      Alert.alert(
        "Google Cast",
        error instanceof Error ? error.message : "Cast could not be changed.",
      );
    }
  }

  const remaining = Math.max(0, (media?.durationMs ?? 0) - (media?.positionMs ?? 0));
  const sleepRemaining = sleepTimerEndsAt
    ? Math.max(0, sleepTimerEndsAt - clock)
    : null;
  const buffering = media?.playbackStatus === "buffering";

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.xl },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          style={styles.headerButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close now playing"
        >
          <Text style={styles.headerButtonText}>⌄</Text>
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.headerEyebrow}>
            {cast.connected ? "CASTING" : media?.source === "download" ? "PLAYING OFFLINE" : "NOW PLAYING"}
          </Text>
          {cast.session ? (
            <Text style={styles.headerDevice} numberOfLines={1}>
              {cast.session.deviceName}
            </Text>
          ) : null}
        </View>
        <Pressable
          style={styles.headerButton}
          onPress={() => router.push("/queue")}
          accessibilityRole="button"
          accessibilityLabel="Open queue"
        >
          <Text style={styles.headerButtonText}>☷</Text>
        </Pressable>
      </View>

      <View style={styles.artworkFrame}>
        {media?.artworkUrl ? (
          <Image
            source={{ uri: media.artworkUrl }}
            style={styles.artwork}
            contentFit="cover"
            transition={180}
          />
        ) : (
          <View style={styles.artworkFallback}>
            <Text style={styles.artworkFallbackText}>PW</Text>
          </View>
        )}
      </View>

      <View style={styles.titles}>
        <Text style={styles.episodeTitle} numberOfLines={3}>
          {media?.title ?? "Nothing playing"}
        </Text>
        <Text style={styles.podcastTitle} numberOfLines={1}>
          {media?.podcastTitle ?? "Choose an episode from your library"}
        </Text>
      </View>

      <View style={styles.progressSection}>
        <SeekBar
          positionMs={media?.positionMs ?? 0}
          bufferedPositionMs={media?.bufferedPositionMs ?? 0}
          durationMs={media?.durationMs ?? null}
          onSeek={(position) => void playbackController.seekTo(position)}
        />
        <View style={styles.timestamps}>
          <Text style={styles.timestamp}>{formatMs(media?.positionMs ?? 0)}</Text>
          <Text style={styles.timestamp}>-{formatMs(remaining)}</Text>
        </View>
      </View>

      <View style={styles.controls}>
        <Control label="Previous" symbol="|◀" onPress={() => playbackController.previous()} />
        <Control label={`Back ${backward} seconds`} symbol={`↶${backward}`} onPress={() => playbackController.skipBackward()} />
        <Pressable
          style={({ pressed }) => [styles.playButton, pressed && styles.pressed]}
          onPress={() => void togglePlay()}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? "Pause" : "Play"}
        >
          {buffering ? (
            <ActivityIndicator size="large" color={colors.textOnAccent} />
          ) : (
            <Text style={styles.playSymbol}>{isPlaying ? "Ⅱ" : "▶"}</Text>
          )}
        </Pressable>
        <Control label={`Forward ${forward} seconds`} symbol={`${forward}↷`} onPress={() => playbackController.skipForward()} />
        <Control label="Next" symbol="▶|" onPress={() => playbackController.next()} />
      </View>

      <View style={styles.rateRow}>
        {[0.8, 1, 1.2, 1.5, 2].map((rate) => (
          <Pressable
            key={rate}
            style={[
              styles.rateButton,
              media?.playbackRate === rate && styles.rateButtonActive,
              media?.source === "cast" && styles.disabled,
            ]}
            disabled={media?.source === "cast"}
            onPress={() => void playbackController.setPlaybackRate(rate)}
            accessibilityRole="button"
            accessibilityState={{ selected: media?.playbackRate === rate }}
          >
            <Text
              style={[
                styles.rateText,
                media?.playbackRate === rate && styles.rateTextActive,
              ]}
            >
              {rate}×
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.tools}>
        <Pressable
          style={({ pressed }) => [styles.tool, pressed && styles.pressed]}
          onPress={chooseSleepTimer}
          accessibilityRole="button"
        >
          <Text style={styles.toolIcon}>◷</Text>
          <Text style={styles.toolLabel}>
            {stopAtEpisodeEnd
              ? "End of episode"
              : sleepRemaining !== null
                ? `${Math.ceil(sleepRemaining / 60_000)} min`
                : "Sleep timer"}
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.tool,
            cast.connected && styles.toolActive,
            pressed && styles.pressed,
            castStatus === "connecting" && styles.disabled,
          ]}
          disabled={castStatus === "connecting"}
          onPress={() => void toggleCast()}
          accessibilityRole="button"
        >
          {castStatus === "connecting" ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Text style={[styles.toolIcon, cast.connected && styles.toolActiveText]}>▣</Text>
          )}
          <Text style={[styles.toolLabel, cast.connected && styles.toolActiveText]}>
            {cast.connected ? "Stop Cast" : "Cast"}
          </Text>
        </Pressable>

        {episode.data ? <DownloadAction episode={episode.data} /> : null}
      </View>

      {castError ? <Text style={styles.error}>{castError}</Text> : null}
      {media?.lastError ? (
        <Text style={styles.error}>
          {media.lastError.code}: {media.lastError.message}
        </Text>
      ) : null}
    </ScrollView>
  );
}

function Control({
  label,
  symbol,
  onPress,
}: {
  label: string;
  symbol: string;
  onPress: () => void | Promise<void>;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.control, pressed && styles.pressed]}
      onPress={() => void onPress()}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.controlSymbol}>{symbol}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  header: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
    backgroundColor: colors.bgSurface,
  },
  headerButtonText: { color: colors.textPrimary, fontSize: fontSizes.xl },
  headerCopy: { flex: 1, alignItems: "center" },
  headerEyebrow: {
    color: colors.textSecondary,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
    letterSpacing: 1.4,
  },
  headerDevice: { color: colors.accent, fontSize: fontSizes.xs, marginTop: 2 },
  artworkFrame: {
    width: "100%",
    aspectRatio: 1,
    maxWidth: 520,
    alignSelf: "center",
    borderRadius: radii.xl,
    overflow: "hidden",
    backgroundColor: colors.bgElevated,
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
  },
  artwork: { width: "100%", height: "100%" },
  artworkFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  artworkFallbackText: {
    color: colors.textMuted,
    fontSize: 64,
    fontWeight: fontWeights.bold,
  },
  titles: { gap: spacing.xs },
  episodeTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.xxl,
    lineHeight: 30,
    fontWeight: fontWeights.bold,
  },
  podcastTitle: {
    color: colors.accent,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.medium,
  },
  progressSection: { gap: spacing.xs },
  seekTouch: { height: 28, justifyContent: "center" },
  seekTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.bgElevated,
  },
  buffered: {
    position: "absolute",
    left: 0,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.textMuted,
  },
  played: {
    position: "absolute",
    left: 0,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  thumb: {
    position: "absolute",
    width: 16,
    height: 16,
    marginLeft: -8,
    top: -5.5,
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  timestamps: { flexDirection: "row", justifyContent: "space-between" },
  timestamp: {
    color: colors.textSecondary,
    fontSize: fontSizes.xs,
    fontVariant: ["tabular-nums"],
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  control: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
  },
  controlSymbol: {
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
  },
  playButton: {
    width: 74,
    height: 74,
    borderRadius: 37,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  playSymbol: { color: colors.textOnAccent, fontSize: 30, fontWeight: fontWeights.bold },
  rateRow: { flexDirection: "row", justifyContent: "center", gap: spacing.sm },
  rateButton: {
    minWidth: 48,
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
    backgroundColor: colors.bgSurface,
  },
  rateButtonActive: { backgroundColor: colors.accentDim },
  rateText: { color: colors.textSecondary, fontSize: fontSizes.xs },
  rateTextActive: { color: colors.accent, fontWeight: fontWeights.bold },
  tools: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tool: {
    minHeight: 46,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSurface,
  },
  toolActive: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  toolIcon: { color: colors.textSecondary, fontSize: fontSizes.lg },
  toolLabel: {
    color: colors.textSecondary,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
  },
  toolActiveText: { color: colors.accent },
  error: {
    color: colors.error,
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    padding: spacing.md,
    borderRadius: radii.md,
  },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.45 },
});

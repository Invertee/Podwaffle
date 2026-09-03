import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  type LayoutChangeEvent,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { api } from "../api/client";
import { EpisodeInfoModal } from "../components/EpisodeInfoModal";
import { Icon } from "../components/Icon";
import { useCastAction } from "../hooks/useCastAction";
import { playbackController } from "../playback/controller";
import { usePlaybackPresentation } from "../playback/presentation";
import { useAuthStore } from "../stores/auth";
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
  const buffered =
    duration > 0 ? Math.min(1, bufferedPositionMs / duration) : 0;

  function seekAt(locationX: number) {
    if (duration <= 0) return;
    onSeek(Math.round(Math.max(0, Math.min(1, locationX / width)) * duration));
  }

  return (
    <Pressable
      style={styles.seekTouch}
      onLayout={(event: LayoutChangeEvent) =>
        setWidth(event.nativeEvent.layout.width)
      }
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
  const router = useRouter();
  const { height } = useWindowDimensions();
  const { cast, castStatus, toggleCast } = useCastAction();
  const presentation = usePlaybackPresentation();
  const media = presentation.media;
  const isPlaying = presentation.isPlaying;
  const credentials = useAuthStore((state) => state.credentials);
  const snapshot = useAuthStore((state) => state.snapshot);
  const backward = useAuthStore((state) => state.skipBackwardSeconds);
  const forward = useAuthStore((state) => state.skipForwardSeconds);
  const [infoOpen, setInfoOpen] = useState(false);
  const dragY = useRef(new Animated.Value(height)).current;
  const scrollOffsetY = useRef(0);

  const episode = useQuery({
    queryKey: ["android-now-playing-episode", media?.episodeId],
    queryFn: () =>
      api.episode(
        credentials!.serverUrl,
        credentials!.token,
        media!.episodeId!,
      ),
    enabled: Boolean(credentials && media?.episodeId),
  });

  useEffect(() => {
    Animated.timing(dragY, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [dragY]);

  const collapsePlayer = useCallback(() => {
    Animated.timing(dragY, {
      toValue: height + 80,
      duration: 180,
      useNativeDriver: true,
    }).start(() => router.back());
  }, [dragY, height, router]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          scrollOffsetY.current <= 4 &&
          gesture.dy > 8 &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          scrollOffsetY.current <= 4 &&
          gesture.dy > 8 &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_event, gesture) => {
          dragY.setValue(Math.max(0, gesture.dy));
        },
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy > 90 || gesture.vy > 0.7) {
            collapsePlayer();
            return;
          }
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        },
      }),
    [collapsePlayer, dragY],
  );

  async function togglePlay() {
    try {
      if (isPlaying) await playbackController.pause();
      else await playbackController.play();
    } catch (error) {
      Alert.alert(
        "Playback failed",
        error instanceof Error
          ? error.message
          : "Playback could not be changed.",
      );
    }
  }

  async function changeCast() {
    try {
      await toggleCast();
    } catch (error) {
      Alert.alert(
        "Google Cast",
        error instanceof Error ? error.message : "Cast could not be changed.",
      );
    }
  }

  const playbackEpisode = snapshot?.playback?.episode;
  const cachedEpisode =
    playbackEpisode?.id === media?.episodeId
      ? playbackEpisode
      : snapshot?.queue.find((item) => item.episode.id === media?.episodeId)
          ?.episode;
  const infoEpisode = episode.data ?? cachedEpisode ?? null;
  const remaining = Math.max(
    0,
    (media?.durationMs ?? 0) - (media?.positionMs ?? 0),
  );
  const buffering = media?.playbackStatus === "buffering";
  const artworkUrl =
    infoEpisode?.podcastArtworkUrl ??
    media?.artworkUrl ??
    infoEpisode?.artworkUrl ??
    null;
  const castBusy = castStatus === "connecting" || castStatus === "stopping";

  return (
    <>
      <Animated.View
        style={[styles.container, { transform: [{ translateY: dragY }] }]}
        {...panResponder.panHandlers}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          onScroll={(event) => {
            scrollOffsetY.current = event.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
        >
          <View style={styles.dragArea}>
            <View style={styles.dragHandle} />
            <View style={styles.header}>
              <HeaderButton
                icon="back"
                label="Collapse now playing"
                onPress={collapsePlayer}
              />
              <View style={styles.headerCopy}>
                <Text style={styles.headerEyebrow}>
                  {presentation.remote
                    ? "REMOTE PLAYBACK"
                    : cast.connected
                      ? "CASTING"
                      : media?.source === "download"
                        ? "PLAYING OFFLINE"
                        : "NOW PLAYING"}
                </Text>
                {presentation.remote ? (
                  <Text style={styles.headerDevice} numberOfLines={1}>
                    Playing on {presentation.ownerDeviceName}
                  </Text>
                ) : cast.session ? (
                  <Text style={styles.headerDevice} numberOfLines={1}>
                    {cast.session.deviceName}
                  </Text>
                ) : null}
              </View>
              <HeaderButton
                icon="queue"
                label="Open queue"
                onPress={() => router.push("/queue")}
              />
            </View>
          </View>

          <View style={styles.artworkFrame}>
            {artworkUrl ? (
              <Image
                source={{ uri: artworkUrl }}
                style={styles.artwork}
                contentFit="cover"
                cachePolicy="memory-disk"
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
              <Text style={styles.timestamp}>
                {formatMs(media?.positionMs ?? 0)}
              </Text>
              <Text style={styles.timestamp}>-{formatMs(remaining)}</Text>
            </View>
          </View>

          <View style={styles.controls}>
            <Transport
              icon="previous"
              label={`Back ${backward} seconds`}
              onPress={() => playbackController.skipBackward()}
            />
            <Pressable
              style={({ pressed }) => [
                styles.playButton,
                pressed && styles.pressed,
              ]}
              onPress={() => void togglePlay()}
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? "Pause" : "Play"}
            >
              {buffering ? (
                <ActivityIndicator size="large" color={colors.textOnAccent} />
              ) : (
                <Icon
                  name={isPlaying ? "pause" : "play"}
                  size={30}
                  color={colors.textOnAccent}
                />
              )}
            </Pressable>
            <Transport
              icon="next"
              label={`Forward ${forward} seconds`}
              onPress={() => playbackController.skipForward()}
            />
          </View>

          <View style={styles.tools}>
            <Pressable
              style={({ pressed }) => [
                styles.tool,
                pressed && Boolean(media?.episodeId) && styles.pressed,
                !media?.episodeId && styles.disabled,
              ]}
              disabled={!media?.episodeId}
              onPress={() => setInfoOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Episode information"
            >
              <Icon name="info" size={21} color={colors.textSecondary} />
              <Text style={styles.toolLabel}>Episode info</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.tool, pressed && styles.pressed]}
              onPress={() => router.push("/queue")}
              accessibilityRole="button"
              accessibilityLabel="Open current queue"
            >
              <Icon name="queue" size={21} color={colors.textSecondary} />
              <Text style={styles.toolLabel}>Queue</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.tool,
                cast.connected && styles.toolActive,
                pressed && !castBusy && styles.pressed,
                castBusy && styles.disabled,
              ]}
              disabled={castBusy}
              onPress={() => void changeCast()}
              accessibilityRole="button"
              accessibilityLabel={cast.connected ? "Stop casting" : "Cast"}
            >
              {castBusy ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Icon
                  name="cast"
                  size={21}
                  color={cast.connected ? colors.accent : colors.textSecondary}
                />
              )}
              <Text
                style={[
                  styles.toolLabel,
                  cast.connected && styles.toolActiveText,
                ]}
              >
                {cast.connected ? "Stop Cast" : "Cast"}
              </Text>
            </Pressable>
          </View>

          {media?.lastError ? (
            <Text style={styles.error}>
              {media.lastError.code}: {media.lastError.message}
            </Text>
          ) : null}
        </ScrollView>
      </Animated.View>

      <EpisodeInfoModal
        visible={infoOpen}
        episode={infoEpisode}
        loading={episode.isLoading && !infoEpisode}
        onClose={() => setInfoOpen(false)}
      />
    </>
  );
}

function HeaderButton({
  icon,
  label,
  onPress,
}: {
  icon: "back" | "queue";
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} size={22} color={colors.textPrimary} />
    </Pressable>
  );
}

function Transport({
  icon,
  label,
  onPress,
}: {
  icon: "previous" | "next";
  label: string;
  onPress: () => void | Promise<void>;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.control, pressed && styles.pressed]}
      onPress={() => void onPress()}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} size={28} color={colors.textPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    overflow: "hidden",
  },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  dragArea: { gap: spacing.xs },
  dragHandle: {
    width: 44,
    height: 4,
    alignSelf: "center",
    borderRadius: 2,
    backgroundColor: colors.textMuted,
  },
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
  headerCopy: { flex: 1, alignItems: "center" },
  headerEyebrow: {
    color: colors.textSecondary,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
    letterSpacing: 1.4,
  },
  headerDevice: { color: colors.accent, fontSize: fontSizes.xs, marginTop: 2 },
  artworkFrame: {
    width: "68%",
    aspectRatio: 1,
    maxWidth: 320,
    alignSelf: "center",
    borderRadius: radii.xl,
    overflow: "hidden",
    backgroundColor: colors.bgElevated,
  },
  artwork: { width: "100%", height: "100%" },
  artworkFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  artworkFallbackText: {
    color: colors.textMuted,
    fontSize: 64,
    fontWeight: fontWeights.bold,
  },
  titles: { gap: spacing.xs, alignItems: "center" },
  episodeTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.xxl,
    lineHeight: 30,
    fontWeight: fontWeights.bold,
    textAlign: "center",
  },
  podcastTitle: {
    color: colors.accent,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.medium,
    textAlign: "center",
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
    justifyContent: "center",
    gap: spacing.xl,
  },
  control: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
    backgroundColor: colors.transportControl,
  },
  playButton: {
    width: 74,
    height: 74,
    borderRadius: 37,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  tools: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.sm,
  },
  tool: {
    flex: 1,
    minHeight: 46,
    minWidth: 0,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSurface,
  },
  toolActive: { borderColor: colors.accent, backgroundColor: colors.accentDim },
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
    textAlign: "center",
  },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.45 },
});

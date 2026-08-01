import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect } from "react";
import { Alert, AppState, Linking, StyleSheet, View } from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import {
  MEDIA_EVENTS,
  PodwaffleMediaModule,
  type NativeCastState,
  type NativeDownload,
  type NativeEpisodeCompletion,
  type NativePlaybackState,
} from "../native-media/index";
import { AppChrome } from "../components/AppChrome";
import { playbackController } from "../playback/controller";
import { useAuthStore } from "../stores/auth";
import { useDownloadsStore } from "../stores/downloads";
import { useNativeMediaStore } from "../stores/nativeMedia";
import { syncRuntime } from "../sync/runtime";
import { APP_CHROME_HEIGHT, colors } from "../styles/tokens";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 2 } },
});

function NativeMediaBinder() {
  const { updateState, updatePosition, updateCastState, setBound, setBinding } =
    useNativeMediaStore();

  const bindToService = useCallback(async () => {
    setBinding(true);
    try {
      const [initialState, castState] = await Promise.all([
        PodwaffleMediaModule.bind(),
        PodwaffleMediaModule.getCastState().catch(() => null),
      ]);
      updateState(initialState);
      playbackController.handleNativeState(initialState);
      if (castState) playbackController.handleCastState(castState);
      setBound(true);
      await useDownloadsStore.getState().load();
      void PodwaffleMediaModule.runDownloadMaintenance();
    } catch (error) {
      console.warn("[NativeMediaBinder] Failed to bind:", error);
      setBound(false);
    } finally {
      setBinding(false);
    }
  }, [setBinding, updateState, updateCastState, setBound]);

  useEffect(() => {
    void bindToService();
    const subscriptions = [
      PodwaffleMediaModule.addListener(MEDIA_EVENTS.STATE_CHANGED, (data) => {
        const state = data as NativePlaybackState;
        updateState(state);
        playbackController.handleNativeState(state);
      }),
      PodwaffleMediaModule.addListener(MEDIA_EVENTS.POSITION_CHANGED, (data) => {
        const position = data as { positionMs: number; bufferedPositionMs: number };
        updatePosition(position.positionMs, position.bufferedPositionMs);
        playbackController.handleNativePosition();
      }),
      PodwaffleMediaModule.addListener(MEDIA_EVENTS.ITEM_ENDED, (data) =>
        playbackController.handleNativeCompletion(data as NativeEpisodeCompletion),
      ),
      PodwaffleMediaModule.addListener(MEDIA_EVENTS.CAST_STATE_CHANGED, (data) => {
        const cast = data as NativeCastState;
        updateCastState(cast);
        playbackController.handleCastState(cast);
      }),
      PodwaffleMediaModule.addListener(MEDIA_EVENTS.DOWNLOAD_STATE_CHANGED, (data) =>
        useDownloadsStore.getState().apply(data as NativeDownload),
      ),
      PodwaffleMediaModule.addListener(
        MEDIA_EVENTS.DOWNLOAD_MAINTENANCE_COMPLETED,
        () => void useDownloadsStore.getState().load(),
      ),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [bindToService, updateState, updatePosition, updateCastState]);

  return null;
}

function RuntimeBinder() {
  const restore = useAuthStore((state) => state.restore);
  const refresh = useAuthStore((state) => state.refresh);
  const status = useAuthStore((state) => state.status);
  const credentials = useAuthStore((state) => state.credentials);
  const revision = useAuthStore((state) => state.snapshot?.revision ?? 0);
  const queueSignature = useAuthStore((state) =>
    state.snapshot?.queue.map((item) => item.id).join(":") ?? "",
  );
  const sharedPlayback = useAuthStore((state) => state.snapshot?.playback ?? null);
  const sharedPlaybackSignature = sharedPlayback
    ? [
        sharedPlayback.episode?.id ?? "",
        sharedPlayback.activeDeviceId ?? "",
        sharedPlayback.mode,
        sharedPlayback.state,
        sharedPlayback.positionMs,
        sharedPlayback.leaseExpiresAt ?? "",
      ].join(":")
    : "";

  useEffect(() => void restore(), [restore]);

  useEffect(() => {
    if (status === "authenticated" && credentials) {
      syncRuntime.start(credentials, revision);
      void playbackController.ensureNotificationPermission().then((granted) => {
        if (granted) return;
        Alert.alert(
          "Enable playback controls",
          "Allow Podwaffle notifications to show the current podcast and playback controls on the lock screen.",
          [
            { text: "Not now", style: "cancel" },
            { text: "Open settings", onPress: () => void Linking.openSettings() },
          ],
        );
      });
    } else {
      syncRuntime.stop();
    }
    return () => syncRuntime.stop();
  }, [status, credentials]);

  useEffect(() => {
    syncRuntime.updateRevision(revision);
    if (revision > 0) void queryClient.invalidateQueries();
  }, [revision]);

  useEffect(() => {
    void playbackController.syncNativeQueue(
      useNativeMediaStore.getState().state?.episodeId ?? undefined,
    );
  }, [queueSignature]);

  useEffect(() => {
    playbackController.applySharedPlayback(sharedPlayback);
  }, [sharedPlaybackSignature]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refresh();
        void playbackController.flushPendingPlayback();
        syncRuntime.reconnect();
        void useDownloadsStore.getState().load();
      } else {
        void playbackController.flush();
      }
    });
    return () => subscription.remove();
  }, [refresh]);

  return null;
}

function AppNavigator() {
  const insets = useSafeAreaInsets();
  const authenticated = useAuthStore((state) => state.status === "authenticated");

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View
        style={[
          styles.navigator,
          authenticated && { paddingBottom: APP_CHROME_HEIGHT + insets.bottom },
        ]}
      >
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bgPrimary },
            animation: "none",
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="join" />
          <Stack.Screen name="podcast/[podcastId]" />
          <Stack.Screen name="queue" />
          <Stack.Screen name="now-playing" />
        </Stack>
      </View>
      <AppChrome />
    </SafeAreaView>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="light" backgroundColor={colors.bgPrimary} />
        <NativeMediaBinder />
        <RuntimeBinder />
        <AppNavigator />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bgPrimary },
  navigator: { flex: 1, backgroundColor: colors.bgPrimary },
});

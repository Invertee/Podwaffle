import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Linking, StyleSheet, View } from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { api } from "../api/client";
import { warmEpisodeCache } from "../api/queryCache";
import { AppChrome } from "../components/AppChrome";
import { ArtworkCacheWarmer } from "../components/ArtworkCacheWarmer";
import {
  MEDIA_EVENTS,
  PodwaffleCacheModule,
  PodwaffleMediaModule,
  type NativeCastState,
  type NativeDownload,
  type NativeEpisodeCompletion,
  type NativePlaybackState,
} from "../native-media/index";
import {
  PodwaffleConnectivityModule,
  type NativeConnectionState,
} from "../native-media/connectivity";
import { playbackController } from "../playback/controller";
import { useAuthStore } from "../stores/auth";
import { useDownloadsStore } from "../stores/downloads";
import { useNativeMediaStore } from "../stores/nativeMedia";
import { APP_CHROME_HEIGHT, colors, TAB_BAR_HEIGHT } from "../styles/tokens";
import {
  playbackSyncPolicy,
  type ConnectionTransport,
} from "../sync/policy";
import { syncRuntime } from "../sync/runtime";

const BACKGROUND_POSITION_PROCESS_INTERVAL_MS = 5_000;

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 2 } },
});

function NativeMediaBinder() {
  const { updateState, updatePosition, updateCastState, setBound, setBinding } =
    useNativeMediaStore();
  const lastBackgroundPositionAt = useRef(0);

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
      void PodwaffleCacheModule.runMaintenance();
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
        const now = Date.now();
        const appActive = AppState.currentState === "active";
        if (
          !appActive &&
          now - lastBackgroundPositionAt.current <
            BACKGROUND_POSITION_PROCESS_INTERVAL_MS
        ) {
          return;
        }
        lastBackgroundPositionAt.current = now;
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
  const setSkipDurations = useAuthStore((state) => state.setSkipDurations);
  const status = useAuthStore((state) => state.status);
  const credentials = useAuthStore((state) => state.credentials);
  const revision = useAuthStore((state) => state.snapshot?.revision ?? 0);
  const profileId = useAuthStore(
    (state) => state.session?.profile.id ?? state.snapshot?.profile.id,
  );
  const profilePlaybackSettings = useAuthStore(
    (state) => state.snapshot?.profile.settings.playback,
  );
  const snapshotSubscriptions = useAuthStore(
    (state) => state.snapshot?.subscriptions,
  );
  const subscriptionSignature =
    snapshotSubscriptions?.map((item) => item.id).join(":") ?? "";
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
  const [networkTransport, setNetworkTransport] =
    useState<ConnectionTransport>("unknown");
  const priorLiveSyncEnabled = useRef<boolean | null>(null);
  const liveSyncEnabled =
    networkTransport === "wifi" || networkTransport === "ethernet";

  const applyConnectionState = useCallback((state: NativeConnectionState) => {
    playbackSyncPolicy.setTransport(state.transport);
    setNetworkTransport(state.transport);
  }, []);

  const refreshConnectionState = useCallback(async () => {
    try {
      applyConnectionState(await PodwaffleConnectivityModule.getState());
    } catch {
      playbackSyncPolicy.setTransport("unknown");
      setNetworkTransport("unknown");
    }
  }, [applyConnectionState]);

  useEffect(() => void restore(), [restore]);

  useEffect(() => {
    void refreshConnectionState();
    const subscription = PodwaffleConnectivityModule.addListener(applyConnectionState);
    return () => subscription.remove();
  }, [applyConnectionState, refreshConnectionState]);

  useEffect(() => {
    if (status !== "authenticated" || !credentials) return;
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
  }, [status, credentials]);

  useEffect(() => {
    if (status === "authenticated" && credentials && liveSyncEnabled) {
      const currentRevision = useAuthStore.getState().snapshot?.revision ?? 0;
      syncRuntime.start(credentials, currentRevision);
    } else {
      syncRuntime.stop();
    }
    return () => syncRuntime.stop();
  }, [status, credentials, liveSyncEnabled]);

  useEffect(() => {
    const previous = priorLiveSyncEnabled.current;
    priorLiveSyncEnabled.current = liveSyncEnabled;
    if (status !== "authenticated" || !credentials || previous === null) return;

    if (previous !== liveSyncEnabled) {
      void playbackController.flush();
    }
    if (!previous && liveSyncEnabled) {
      void refresh();
    }
  }, [status, credentials, liveSyncEnabled, refresh]);

  useEffect(() => {
    syncRuntime.updateRevision(revision);
    if (revision > 0) void queryClient.invalidateQueries();
  }, [revision]);

  useEffect(() => {
    if (!profilePlaybackSettings) return;
    void setSkipDurations(
      profilePlaybackSettings.skipBackwardSeconds,
      profilePlaybackSettings.skipForwardSeconds,
    );
  }, [
    profilePlaybackSettings?.skipBackwardSeconds,
    profilePlaybackSettings?.skipForwardSeconds,
    setSkipDurations,
  ]);

  useEffect(() => {
    if (!credentials || !profileId || !snapshotSubscriptions?.length) return;
    void warmEpisodeCache(
      profileId,
      snapshotSubscriptions.map((item) => item.id),
      (podcastId) =>
        api.episodes(credentials.serverUrl, credentials.token, podcastId),
    );
  }, [credentials, profileId, subscriptionSignature]);

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
        void refreshConnectionState();
        void refresh();
        void playbackController.flushPendingPlayback();
        if (playbackSyncPolicy.liveSyncEnabled) syncRuntime.reconnect();
        void useDownloadsStore.getState().load();
      } else {
        void playbackController.flush();
      }
    });
    return () => subscription.remove();
  }, [refresh, refreshConnectionState]);

  return null;
}

function AppNavigator() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const authenticated = useAuthStore((state) => state.status === "authenticated");
  const playerExpanded = pathname === "/now-playing";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View
        style={[
          styles.navigator,
          authenticated && {
            paddingBottom:
              (playerExpanded ? TAB_BAR_HEIGHT : APP_CHROME_HEIGHT) + insets.bottom,
          },
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
          <Stack.Screen
            name="now-playing"
            options={{
              presentation: "transparentModal",
              contentStyle: { backgroundColor: "transparent" },
            }}
          />
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
        <ArtworkCacheWarmer />
        <AppNavigator />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  navigator: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
});

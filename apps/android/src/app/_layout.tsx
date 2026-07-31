import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { MEDIA_EVENTS, PodwaffleMediaModule } from "../native-media/index";
import type { NativePlaybackState } from "../native-media/index";
import { playbackController } from "../playback/controller";
import { useAuthStore } from "../stores/auth";
import { useNativeMediaStore } from "../stores/nativeMedia";
import { colors } from "../styles/tokens";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
    },
  },
});

function NativeMediaBinder() {
  const { updateState, updatePosition, setBound, setBinding } =
    useNativeMediaStore();

  const bindToService = useCallback(async () => {
    setBinding(true);
    try {
      const initialState = await PodwaffleMediaModule.bind();
      updateState(initialState);
      playbackController.handleNativeState(initialState);
      setBound(true);
    } catch (err) {
      console.warn("[NativeMediaBinder] Failed to bind to media service:", err);
      setBound(false);
    } finally {
      setBinding(false);
    }
  }, [setBinding, updateState, setBound]);

  useEffect(() => {
    void bindToService();

    const stateSub = PodwaffleMediaModule.addListener(
      MEDIA_EVENTS.STATE_CHANGED,
      (data: unknown) => {
        const state = data as NativePlaybackState;
        updateState(state);
        playbackController.handleNativeState(state);
      },
    );

    const posSub = PodwaffleMediaModule.addListener(
      MEDIA_EVENTS.POSITION_CHANGED,
      (data: unknown) => {
        const position = data as {
          positionMs: number;
          bufferedPositionMs: number;
        };
        updatePosition(position.positionMs, position.bufferedPositionMs);
        playbackController.handleNativePosition(
          position.positionMs,
          position.bufferedPositionMs,
        );
      },
    );

    return () => {
      stateSub.remove();
      posSub.remove();
    };
  }, [bindToService, updateState, updatePosition]);

  return null;
}

export default function RootLayout() {
  const restore = useAuthStore((state) => state.restore);
  const refresh = useAuthStore((state) => state.refresh);

  useEffect(() => {
    void restore();
  }, [restore]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
      else void playbackController.flush();
    });
    return () => subscription.remove();
  }, [refresh]);

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="light" backgroundColor={colors.bgPrimary} />
        <NativeMediaBinder />
        <View style={styles.root}>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.bgPrimary },
              headerTintColor: colors.textPrimary,
              headerTitleStyle: { color: colors.textPrimary },
              contentStyle: { backgroundColor: colors.bgPrimary },
              animation: "slide_from_right",
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="join"
              options={{ headerShown: false, animation: "fade" }}
            />
            <Stack.Screen
              name="podcast/[podcastId]"
              options={{ title: "Podcast" }}
            />
            <Stack.Screen name="queue" options={{ title: "Queue" }} />
            <Stack.Screen
              name="now-playing"
              options={{
                title: "Now Playing",
                presentation: "modal",
                animation: "slide_from_bottom",
              }}
            />
          </Stack>
        </View>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgPrimary },
});

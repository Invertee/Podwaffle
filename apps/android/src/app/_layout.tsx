/**
 * Root layout for the Podwaffle Android app.
 *
 * Responsibilities:
 * - Provides QueryClient (TanStack Query)
 * - Binds to the native MediaSessionService on startup
 * - Subscribes to native media events and feeds them into Zustand
 * - Handles the splash screen
 */

import React, { useEffect, useCallback } from "react";
import { AppState, View, StyleSheet } from "react-native";
import { Stack } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { PodwaffleMediaModule, MEDIA_EVENTS } from "../native-media/index";
import type { NativePlaybackState } from "../native-media/index";
import { useNativeMediaStore } from "../stores/nativeMedia";
import { useAuthStore } from "../stores/auth";
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
      setBound(true);
    } catch (err) {
      console.warn("[NativeMediaBinder] Failed to bind to media service:", err);
      setBound(false);
    } finally {
      setBinding(false);
    }
  }, [setBinding, updateState, setBound]);

  useEffect(() => {
    // Bind to the service on mount
    void bindToService();

    // Subscribe to state change events (full state updates)
    const stateSub = PodwaffleMediaModule.addListener(
      MEDIA_EVENTS.STATE_CHANGED,
      (data: unknown) => {
        updateState(data as NativePlaybackState);
      },
    );

    // Subscribe to high-frequency position events (position-only updates)
    const posSub = PodwaffleMediaModule.addListener(
      MEDIA_EVENTS.POSITION_CHANGED,
      (data: unknown) => {
        const d = data as { positionMs: number; bufferedPositionMs: number };
        updatePosition(d.positionMs, d.bufferedPositionMs);
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
              options={{
                headerShown: false,
                animation: "fade",
              }}
            />
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
  root: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
});

/**
 * Bottom tab navigator layout.
 *
 * Tabs: Podcasts | In Progress | Discover | Profile
 *
 * The MiniPlayer is rendered above the tab bar and is always visible
 * when media is loaded.
 */

import React from "react";
import { ActivityIndicator, View, Text, StyleSheet } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MiniPlayer } from "../../components/MiniPlayer";
import { useNativeMediaStore, selectHasMedia } from "../../stores/nativeMedia";
import { useAuthStore } from "../../stores/auth";
import {
  colors,
  fontSizes,
  MINI_PLAYER_HEIGHT,
  TAB_BAR_HEIGHT,
} from "../../styles/tokens";

function TabIcon({ symbol, focused }: { symbol: string; focused: boolean }) {
  return (
    <View style={tabIconStyles.container}>
      <Text style={{ opacity: focused ? 1 : 0.5, fontSize: 16 }}>{symbol}</Text>
    </View>
  );
}

const tabIconStyles = StyleSheet.create({
  container: {
    paddingTop: 2,
    alignItems: "center",
    justifyContent: "center",
  },
});

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const hasMedia = useNativeMediaStore(selectHasMedia);
  const authStatus = useAuthStore((state) => state.status);

  if (authStatus === "restoring") {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>Opening Podwaffle…</Text>
      </View>
    );
  }
  if (authStatus === "signed-out") return <Redirect href="/join" />;

  return (
    <View style={styles.container}>
      {/* Tab screens fill the available space */}
      <View style={styles.screenArea}>
        <Tabs
          screenOptions={{
            tabBarStyle: {
              backgroundColor: colors.playerBg,
              borderTopColor: colors.border,
              borderTopWidth: 1,
              height: TAB_BAR_HEIGHT + insets.bottom,
              paddingBottom: insets.bottom,
            },
            tabBarActiveTintColor: colors.accent,
            tabBarInactiveTintColor: colors.textMuted,
            tabBarLabelStyle: {
              fontSize: fontSizes.xs,
              fontWeight: "600",
            },
            headerStyle: { backgroundColor: colors.bgPrimary },
            headerTintColor: colors.textPrimary,
            headerTitleStyle: {
              color: colors.textPrimary,
              fontSize: fontSizes.lg,
              fontWeight: "700",
            },
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: "Podcasts",
              tabBarIcon: ({ color }) => (
                <TabIcon symbol="🎙" focused={color === colors.accent} />
              ),
            }}
          />
          <Tabs.Screen
            name="in-progress"
            options={{
              title: "In Progress",
              tabBarIcon: ({ color }) => (
                <TabIcon symbol="▶" focused={color === colors.accent} />
              ),
            }}
          />
          <Tabs.Screen
            name="discover"
            options={{
              title: "Discover",
              tabBarIcon: ({ color }) => (
                <TabIcon symbol="🔍" focused={color === colors.accent} />
              ),
            }}
          />
          <Tabs.Screen
            name="profile"
            options={{
              title: "Profile",
              tabBarIcon: ({ color }) => (
                <TabIcon symbol="👤" focused={color === colors.accent} />
              ),
            }}
          />
        </Tabs>
      </View>

      {/* Mini-player sits above the tab bar */}
      {hasMedia && (
        <View style={styles.miniPlayerWrapper}>
          <MiniPlayer />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  screenArea: {
    flex: 1,
    // When media is loaded, push the content up by the mini-player height
    // The tab bar itself is inside Tabs, so we only reserve space for mini-player
    marginBottom: 0,
  },
  miniPlayerWrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    // Position above the tab bar; TAB_BAR_HEIGHT is approximate here;
    // the exact value accounts for safe area in the tab bar itself.
    bottom: TAB_BAR_HEIGHT,
    height: MINI_PLAYER_HEIGHT,
    zIndex: 100,
    elevation: 8,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: colors.bgPrimary,
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: fontSizes.md,
  },
});

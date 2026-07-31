import { Redirect, Tabs } from "expo-router";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MiniPlayer } from "../../components/MiniPlayer";
import { useAuthStore } from "../../stores/auth";
import {
  selectHasMedia,
  useNativeMediaStore,
} from "../../stores/nativeMedia";
import {
  colors,
  fontSizes,
  MINI_PLAYER_HEIGHT,
  TAB_BAR_HEIGHT,
} from "../../styles/tokens";

function TabIcon({ symbol, focused }: { symbol: string; focused: boolean }) {
  return (
    <View style={styles.tabIcon}>
      <Text style={{ opacity: focused ? 1 : 0.5, fontSize: 16 }}>{symbol}</Text>
    </View>
  );
}

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
      <View style={styles.screenArea}>
        <Tabs
          screenOptions={{
            headerShown: false,
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
                <TabIcon symbol="⌕" focused={color === colors.accent} />
              ),
            }}
          />
          <Tabs.Screen
            name="downloads"
            options={{
              title: "Downloads",
              tabBarIcon: ({ color }) => (
                <TabIcon symbol="⇩" focused={color === colors.accent} />
              ),
            }}
          />
          <Tabs.Screen
            name="profile"
            options={{
              title: "Profile",
              tabBarIcon: ({ color }) => (
                <TabIcon symbol="●" focused={color === colors.accent} />
              ),
            }}
          />
        </Tabs>
      </View>

      {hasMedia ? (
        <View
          style={[
            styles.miniPlayerWrapper,
            { bottom: TAB_BAR_HEIGHT + insets.bottom },
          ]}
        >
          <MiniPlayer />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  screenArea: { flex: 1 },
  miniPlayerWrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    height: MINI_PLAYER_HEIGHT,
    zIndex: 100,
    elevation: 8,
  },
  tabIcon: {
    paddingTop: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: colors.bgPrimary,
  },
  loadingText: { color: colors.textSecondary, fontSize: fontSizes.md },
});

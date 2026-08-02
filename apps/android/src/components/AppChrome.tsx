import { type Href, usePathname, useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuthStore } from "../stores/auth";
import {
  APP_CHROME_HEIGHT,
  colors,
  fontSizes,
  fontWeights,
  MINI_PLAYER_HEIGHT,
  TAB_BAR_HEIGHT,
} from "../styles/tokens";
import { Icon, type IconName } from "./Icon";
import { MiniPlayer } from "./MiniPlayer";

const navigation: Array<{
  label: string;
  href: Href;
  path: string;
  icon: IconName;
}> = [
  { label: "Podcasts", href: "/", path: "/", icon: "podcasts" },
  { label: "Progress", href: "/in-progress", path: "/in-progress", icon: "progress" },
  { label: "Discover", href: "/discover", path: "/discover", icon: "discover" },
  { label: "Profile", href: "/profile", path: "/profile", icon: "profile" },
];

export function useChromeHeight(): number {
  const bottom = useSafeAreaInsets().bottom;
  const authenticated = useAuthStore((state) => state.status === "authenticated");
  const pathname = usePathname();
  return authenticated && pathname !== "/now-playing"
    ? APP_CHROME_HEIGHT + bottom
    : 0;
}

export function AppChrome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const authenticated = useAuthStore((state) => state.status === "authenticated");

  if (!authenticated || pathname === "/now-playing") return null;

  return (
    <View style={[styles.chrome, { paddingBottom: insets.bottom }]}>
      <MiniPlayer />
      <View style={styles.navigation}>
        {navigation.map((item) => {
          const active =
            item.path === "/"
              ? pathname === "/" || pathname.startsWith("/podcast/")
              : pathname === item.path;
          return (
            <Pressable
              key={item.path}
              style={({ pressed }) => [styles.navItem, pressed && styles.pressed]}
              onPress={() => router.replace(item.href)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
            >
              <Icon
                name={item.icon}
                size={22}
                color={active ? colors.accent : colors.textMuted}
                strokeWidth={active ? 2.1 : 1.8}
              />
              <Text style={[styles.navLabel, active && styles.navLabelActive]} numberOfLines={1}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chrome: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: APP_CHROME_HEIGHT,
    backgroundColor: colors.playerBg,
    borderTopWidth: 1,
    borderTopColor: colors.playerBorder,
    zIndex: 500,
    elevation: 20,
  },
  navigation: {
    height: TAB_BAR_HEIGHT,
    flexDirection: "row",
    alignItems: "stretch",
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  navItem: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  navLabel: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.medium,
  },
  navLabelActive: { color: colors.accent, fontWeight: fontWeights.bold },
  pressed: { opacity: 0.68 },
});

export const CHROME_PLAYER_HEIGHT = MINI_PLAYER_HEIGHT;

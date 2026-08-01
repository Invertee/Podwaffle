import { Redirect, Stack } from "expo-router";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { useAuthStore } from "../../stores/auth";
import { colors, fontSizes } from "../../styles/tokens";

export default function TabLayout() {
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
    <Stack screenOptions={{ headerShown: false, animation: "none" }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="in-progress" />
      <Stack.Screen name="discover" />
      <Stack.Screen name="profile" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: colors.bgPrimary,
  },
  loadingText: { color: colors.textSecondary, fontSize: fontSizes.md },
});

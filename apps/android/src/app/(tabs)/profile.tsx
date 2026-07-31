import React from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Constants from "expo-constants";

import { useAuthStore } from "../../stores/auth";
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
} from "../../styles/tokens";

export default function ProfileScreen() {
  const session = useAuthStore((state) => state.session);
  const snapshot = useAuthStore((state) => state.snapshot);
  const credentials = useAuthStore((state) => state.credentials);
  const connection = useAuthStore((state) => state.connection);
  const lastSyncAt = useAuthStore((state) => state.lastSyncAt);
  const error = useAuthStore((state) => state.error);
  const refresh = useAuthStore((state) => state.refresh);
  const logout = useAuthStore((state) => state.logout);
  const profile = session?.profile ?? snapshot?.profile;

  function confirmLogout() {
    Alert.alert(
      "Disconnect this device?",
      "Saved credentials and cached podcast data will be removed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => void logout(),
        },
      ],
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {(profile?.displayName ?? "P").slice(0, 1).toUpperCase()}
        </Text>
      </View>
      <Text style={styles.title}>{profile?.displayName ?? "Podwaffle"}</Text>
      <Text style={styles.subtitle}>{credentials?.serverUrl}</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Connection</Text>
        <Row
          label="Status"
          value={
            connection === "online"
              ? "Connected"
              : connection === "checking"
                ? "Checking…"
                : "Offline"
          }
          valueColor={connection === "online" ? colors.success : colors.warning}
        />
        <Row
          label="Cached revision"
          value={String(snapshot?.revision ?? "None")}
        />
        <Row
          label="Last sync"
          value={lastSyncAt ? new Date(lastSyncAt).toLocaleString() : "Not yet"}
        />
        <Row
          label="App version"
          value={Constants.expoConfig?.version ?? "Development"}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          style={({ pressed }) => [
            styles.refreshButton,
            pressed && styles.pressed,
          ]}
          onPress={() => void refresh()}
          accessibilityRole="button"
        >
          <Text style={styles.refreshText}>Sync now</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>This device</Text>
        <Row label="Name" value={session?.device.name ?? "Android device"} />
        <Row
          label="Device ID"
          value={session?.device.id.slice(0, 8) ?? "Unavailable"}
        />
        <Text style={styles.securityNote}>
          Your device token is kept in Android encrypted storage and is never
          displayed here.
        </Text>
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.disconnectButton,
          pressed && styles.pressed,
        ]}
        onPress={confirmLogout}
        accessibilityRole="button"
      >
        <Text style={styles.disconnectText}>Disconnect this device</Text>
      </Pressable>
    </ScrollView>
  );
}

function Row({
  label,
  value,
  valueColor = colors.textPrimary,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, { color: valueColor }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: {
    padding: spacing.lg,
    paddingBottom: 150,
    alignItems: "center",
    gap: spacing.md,
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: colors.textOnAccent,
    fontSize: fontSizes.xxxl,
    fontWeight: fontWeights.bold,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSizes.xxl,
    fontWeight: fontWeights.bold,
  },
  subtitle: { color: colors.textSecondary, fontSize: fontSizes.sm },
  card: {
    width: "100%",
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.bgSurface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.bold,
    marginBottom: spacing.xs,
  },
  row: {
    minHeight: 34,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
  },
  rowLabel: { color: colors.textSecondary, fontSize: fontSizes.sm },
  rowValue: {
    flex: 1,
    textAlign: "right",
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
  },
  error: { color: colors.error, fontSize: fontSizes.sm, lineHeight: 19 },
  securityNote: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    lineHeight: 17,
    marginTop: spacing.xs,
  },
  refreshButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.accent,
    marginTop: spacing.sm,
  },
  refreshText: {
    color: colors.accent,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
  },
  disconnectButton: {
    width: "100%",
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    marginTop: spacing.sm,
  },
  disconnectText: {
    color: colors.error,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
  },
  pressed: { opacity: 0.7 },
});

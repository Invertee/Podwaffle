import type { Device } from "@podwaffle/contracts";
import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { api } from "../../api/client";
import { updateProfilePlaybackSettings } from "../../api/profileSettings";
import {
  authenticatedConnection,
  refreshProfile,
  withProfileRevision,
} from "../../api/profileMutations";
import { playbackController } from "../../playback/controller";
import { useAuthStore } from "../../stores/auth";
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
} from "../../styles/tokens";

type StatsPeriod = "today" | "7d" | "30d" | "year" | "all";

function formatListeningTime(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  if (hours < 24) return `${hours}h ${totalMinutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export default function ProfileScreen() {
  const session = useAuthStore((state) => state.session);
  const snapshot = useAuthStore((state) => state.snapshot);
  const credentials = useAuthStore((state) => state.credentials);
  const connection = useAuthStore((state) => state.connection);
  const liveSyncConnected = useAuthStore((state) => state.liveSyncConnected);
  const lastSyncAt = useAuthStore((state) => state.lastSyncAt);
  const error = useAuthStore((state) => state.error);
  const refresh = useAuthStore((state) => state.refresh);
  const logout = useAuthStore((state) => state.logout);
  const skipBackwardSeconds = useAuthStore(
    (state) => state.skipBackwardSeconds,
  );
  const skipForwardSeconds = useAuthStore((state) => state.skipForwardSeconds);
  const setSkipDurations = useAuthStore((state) => state.setSkipDurations);
  const profile = session?.profile ?? snapshot?.profile;
  const [period, setPeriod] = useState<StatsPeriod>("30d");
  const [backwardInput, setBackwardInput] = useState(
    String(skipBackwardSeconds),
  );
  const [forwardInput, setForwardInput] = useState(String(skipForwardSeconds));
  const [savingSettings, setSavingSettings] = useState(false);
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);

  useEffect(() => setBackwardInput(String(skipBackwardSeconds)), [skipBackwardSeconds]);
  useEffect(() => setForwardInput(String(skipForwardSeconds)), [skipForwardSeconds]);

  const stats = useQuery({
    queryKey: ["android-stats", period],
    queryFn: () =>
      api.stats(credentials!.serverUrl, credentials!.token, period),
    enabled: Boolean(credentials),
  });
  const devices = useQuery<Device[]>({
    queryKey: ["android-devices"],
    queryFn: () => api.devices(credentials!.serverUrl, credentials!.token),
    enabled: Boolean(credentials),
    initialData: snapshot?.devices,
  });

  async function saveSkipSettings() {
    setSavingSettings(true);
    try {
      await setSkipDurations(Number(backwardInput), Number(forwardInput));
      const current = useAuthStore.getState();
      setBackwardInput(String(current.skipBackwardSeconds));
      setForwardInput(String(current.skipForwardSeconds));
      const currentCredentials = current.credentials;
      const revision = current.snapshot?.revision ?? current.session?.profile.revision;
      if (currentCredentials && revision !== undefined) {
        await updateProfilePlaybackSettings(
          currentCredentials.serverUrl,
          currentCredentials.token,
          {
            skipBackwardSeconds: current.skipBackwardSeconds,
            skipForwardSeconds: current.skipForwardSeconds,
          },
          revision,
        );
        await current.refresh();
      }
    } catch (settingsError) {
      Alert.alert(
        "Settings could not be saved",
        settingsError instanceof Error
          ? settingsError.message
          : "The profile settings could not be updated.",
      );
    } finally {
      setSavingSettings(false);
    }
  }

  function confirmRevoke(device: Device) {
    Alert.alert(
      `Disconnect ${device.name}?`,
      "The device token will stop working immediately.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => void revokeDevice(device),
        },
      ],
    );
  }

  async function revokeDevice(device: Device) {
    setRevokingDeviceId(device.id);
    try {
      const { serverUrl, token } = authenticatedConnection();
      await withProfileRevision((revision) =>
        api.revoke(serverUrl, token, device.id, revision),
      );
      await refreshProfile();
      await devices.refetch();
    } catch (revokeError) {
      Alert.alert(
        "Disconnect failed",
        revokeError instanceof Error
          ? revokeError.message
          : "The device could not be disconnected.",
      );
    } finally {
      setRevokingDeviceId(null);
    }
  }

  function confirmLogout() {
    Alert.alert(
      "Disconnect this device?",
      "Saved credentials and cached podcast data will be removed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () =>
            void (async () => {
              await playbackController.stop().catch(() =>
                playbackController.flush().catch(() => undefined),
              );
              playbackController.reset();
              await logout();
            })(),
        },
      ],
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.identity}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(profile?.displayName ?? "P").slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <View style={styles.identityCopy}>
          <Text style={styles.title}>{profile?.displayName ?? "Podwaffle"}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {credentials?.serverUrl}
          </Text>
          <Text style={styles.timezone}>
            Timezone · {profile?.timezone ?? "Not configured"}
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeading}>
          <View>
            <Text style={styles.eyebrow}>PLAYBACK</Text>
            <Text style={styles.cardTitle}>Skip intervals</Text>
          </View>
          {savingSettings ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : null}
        </View>
        <Text style={styles.cardDescription}>
          Synced across the Android app, web player, and profile devices.
        </Text>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Skip backward</Text>
          <View style={styles.numberField}>
            <TextInput
              value={backwardInput}
              onChangeText={setBackwardInput}
              onBlur={() => void saveSkipSettings()}
              keyboardType="number-pad"
              selectTextOnFocus
              style={styles.numberInput}
              accessibilityLabel="Skip backward seconds"
            />
            <Text style={styles.numberSuffix}>sec</Text>
          </View>
        </View>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Skip forward</Text>
          <View style={styles.numberField}>
            <TextInput
              value={forwardInput}
              onChangeText={setForwardInput}
              onBlur={() => void saveSkipSettings()}
              keyboardType="number-pad"
              selectTextOnFocus
              style={styles.numberInput}
              accessibilityLabel="Skip forward seconds"
            />
            <Text style={styles.numberSuffix}>sec</Text>
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeading}>
          <View>
            <Text style={styles.eyebrow}>YOUR LISTENING</Text>
            <Text style={styles.cardTitle}>Statistics</Text>
          </View>
          {stats.isLoading ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : null}
        </View>
        <View style={styles.periods}>
          {(
            [
              ["today", "Today"],
              ["7d", "7 days"],
              ["30d", "30 days"],
              ["year", "Year"],
              ["all", "All"],
            ] as const
          ).map(([value, label]) => (
            <Pressable
              key={value}
              onPress={() => setPeriod(value)}
              style={[
                styles.periodButton,
                period === value && styles.periodButtonActive,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: period === value }}
            >
              <Text
                style={[
                  styles.periodText,
                  period === value && styles.periodTextActive,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        {stats.error ? (
          <Text style={styles.error}>
            {stats.error instanceof Error
              ? stats.error.message
              : "Statistics could not be loaded."}
          </Text>
        ) : (
          <View style={styles.statGrid}>
            <Stat
              value={formatListeningTime(stats.data?.listenedMs ?? 0)}
              label="Listening time"
            />
            <Stat
              value={String(stats.data?.episodesCompleted ?? 0)}
              label="Episodes completed"
            />
            <Stat
              value={`${stats.data?.currentStreak ?? 0}d`}
              label="Current streak"
            />
            <Stat
              value={`${stats.data?.longestStreak ?? 0}d`}
              label="Longest streak"
            />
            <Stat
              value={String(stats.data?.activeListeningDays ?? 0)}
              label="Active days"
            />
            <Stat
              value={formatListeningTime(stats.data?.skippedForwardMs ?? 0)}
              label="Skipped forward"
            />
          </View>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeading}>
          <View>
            <Text style={styles.eyebrow}>SECURITY</Text>
            <Text style={styles.cardTitle}>Connected devices</Text>
          </View>
          <Text style={styles.deviceCount}>{devices.data?.length ?? 0}</Text>
        </View>
        {devices.data?.map((device: Device) => (
          <View style={styles.device} key={device.id}>
            <View style={styles.deviceIcon}>
              <Text style={styles.deviceIconText}>
                {device.platform === "android" ? "A" : "W"}
              </Text>
            </View>
            <View style={styles.deviceCopy}>
              <Text style={styles.deviceName} numberOfLines={1}>
                {device.name}
              </Text>
              <Text style={styles.deviceMeta} numberOfLines={1}>
                {device.current
                  ? "This device"
                  : `${device.platform} · seen ${new Date(device.lastSeenAt).toLocaleDateString()}`}
              </Text>
            </View>
            {!device.current ? (
              <Pressable
                style={({ pressed }) => [
                  styles.revokeButton,
                  pressed && styles.pressed,
                  revokingDeviceId === device.id && styles.disabled,
                ]}
                disabled={revokingDeviceId === device.id}
                onPress={() => confirmRevoke(device)}
                accessibilityRole="button"
                accessibilityLabel={`Disconnect ${device.name}`}
              >
                {revokingDeviceId === device.id ? (
                  <ActivityIndicator size="small" color={colors.error} />
                ) : (
                  <Text style={styles.revokeText}>Disconnect</Text>
                )}
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>

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
          label="Live sync"
          value={liveSyncConnected ? "Connected" : "Reconnecting"}
          valueColor={liveSyncConnected ? colors.success : colors.warning}
        />
        <Row label="Cached revision" value={String(snapshot?.revision ?? "None")} />
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
          style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}
          onPress={() => void Promise.all([refresh(), stats.refetch(), devices.refetch()])}
          accessibilityRole="button"
        >
          <Text style={styles.refreshText}>Sync now</Text>
        </Pressable>
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

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
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
  content: { padding: spacing.md, paddingBottom: spacing.lg, gap: spacing.md },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  identityCopy: { flex: 1, gap: 3 },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
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
  timezone: { color: colors.textMuted, fontSize: fontSizes.xs },
  card: {
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.bgSurface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
    letterSpacing: 1,
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.bold,
  },
  cardDescription: { color: colors.textSecondary, fontSize: fontSizes.sm, lineHeight: 19 },
  settingRow: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  settingLabel: { color: colors.textSecondary, fontSize: fontSizes.md },
  numberField: {
    width: 100,
    height: 42,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  numberInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
    textAlign: "right",
    paddingHorizontal: spacing.sm,
  },
  numberSuffix: { color: colors.textMuted, fontSize: fontSizes.xs, paddingRight: spacing.sm },
  periods: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  periodButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    borderRadius: radii.full,
    backgroundColor: colors.bgElevated,
  },
  periodButtonActive: { backgroundColor: colors.accentDim },
  periodText: { color: colors.textSecondary, fontSize: fontSizes.xs },
  periodTextActive: { color: colors.accent, fontWeight: fontWeights.bold },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  stat: {
    width: "48%",
    minHeight: 82,
    padding: spacing.md,
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.bgElevated,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.bold,
  },
  statLabel: { color: colors.textSecondary, fontSize: fontSizes.xs, marginTop: 4 },
  deviceCount: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    backgroundColor: colors.bgElevated,
  },
  device: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingTop: spacing.sm,
  },
  deviceIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgElevated,
  },
  deviceIconText: { color: colors.accent, fontWeight: fontWeights.bold },
  deviceCopy: { flex: 1 },
  deviceName: { color: colors.textPrimary, fontSize: fontSizes.sm, fontWeight: fontWeights.semibold },
  deviceMeta: { color: colors.textMuted, fontSize: fontSizes.xs, marginTop: 3 },
  revokeButton: {
    minHeight: 38,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
  },
  revokeText: { color: colors.error, fontSize: fontSizes.xs, fontWeight: fontWeights.semibold },
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
  refreshButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.accent,
    marginTop: spacing.sm,
  },
  refreshText: { color: colors.accent, fontSize: fontSizes.sm, fontWeight: fontWeights.semibold },
  disconnectButton: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
  },
  disconnectText: { color: colors.error, fontSize: fontSizes.md, fontWeight: fontWeights.semibold },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});

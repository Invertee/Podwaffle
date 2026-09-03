import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  notificationJoinCode,
  saveNotificationJoinCode,
} from "../stores/auth";
import {
  clearPushDiagnostics,
  readPushDiagnostics,
  recordPushDiagnostic,
  subscribePushDiagnostics,
  type PushDiagnosticEntry,
} from "../sync/pushDiagnostics";
import { sendPushDiagnosticTestNotification } from "../sync/push";
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
} from "../styles/tokens";

function levelColor(level: PushDiagnosticEntry["level"]): string {
  if (level === "error") return colors.error;
  if (level === "warning") return colors.warning;
  return colors.textMuted;
}

export function PushDiagnosticsCard() {
  const [entries, setEntries] = useState<PushDiagnosticEntry[]>([]);
  const [joinCodeStored, setJoinCodeStored] = useState<boolean | null>(null);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [diagnostics, storedJoinCode] = await Promise.all([
      readPushDiagnostics(),
      notificationJoinCode(),
    ]);
    setEntries(diagnostics);
    setJoinCodeStored(Boolean(storedJoinCode));
  }, []);

  useEffect(() => {
    void refresh();
    return subscribePushDiagnostics(setEntries);
  }, [refresh]);

  async function saveJoinCode() {
    const value = joinCodeInput.trim();
    if (!value) {
      Alert.alert("Join code required", "Enter the current Podwaffle server join code.");
      return;
    }
    setBusy(true);
    try {
      await saveNotificationJoinCode(value);
      await recordPushDiagnostic("push.notification_key.saved", {
        source: "status-page",
      });
      setJoinCodeInput("");
      setJoinCodeStored(true);
      Alert.alert(
        "Notification key saved",
        "Send another Home Assistant notification to test decryption.",
      );
    } catch (error) {
      Alert.alert(
        "Could not save notification key",
        error instanceof Error ? error.message : "Secure storage failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendTestNotification() {
    setBusy(true);
    try {
      const result = await sendPushDiagnosticTestNotification();
      Alert.alert(
        result.shown ? "Test notification posted" : "Notification not shown",
        result.shown
          ? "The Android notification channel is working."
          : result.reason ?? "Android did not display the notification.",
      );
    } catch (error) {
      Alert.alert(
        "Notification test failed",
        error instanceof Error ? error.message : "The notification could not be posted.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function clearLogs() {
    setBusy(true);
    try {
      await clearPushDiagnostics();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.heading}>
        <View>
          <Text style={styles.eyebrow}>DIAGNOSTICS</Text>
          <Text style={styles.title}>Push console</Text>
        </View>
        <Text style={styles.count}>{entries.length}</Text>
      </View>
      <Text style={styles.description}>
        Records Firebase registration, receipt, decryption, and Android display
        events. Message text, join codes, and device tokens are never logged.
      </Text>

      <View style={styles.keyStatus}>
        <Text style={styles.keyLabel}>Notification decryption key</Text>
        <Text
          style={[
            styles.keyValue,
            { color: joinCodeStored ? colors.success : colors.warning },
          ]}
        >
          {joinCodeStored === null
            ? "Checking…"
            : joinCodeStored
              ? "Stored"
              : "Missing"}
        </Text>
      </View>
      {!joinCodeStored ? (
        <Text style={styles.warning}>
          Upgraded installations may not have retained the join code required to
          decrypt Home Assistant messages. Enter the current server join code once
          to repair this device.
        </Text>
      ) : null}
      <View style={styles.keyEditor}>
        <TextInput
          value={joinCodeInput}
          onChangeText={setJoinCodeInput}
          placeholder="Current server join code"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          accessibilityLabel="Notification join code"
        />
        <Pressable
          style={({ pressed }) => [
            styles.compactButton,
            pressed && styles.pressed,
            busy && styles.disabled,
          ]}
          disabled={busy}
          onPress={() => void saveJoinCode()}
          accessibilityRole="button"
        >
          <Text style={styles.compactButtonText}>Save key</Text>
        </Pressable>
      </View>

      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            pressed && styles.pressed,
            busy && styles.disabled,
          ]}
          disabled={busy}
          onPress={() => void sendTestNotification()}
          accessibilityRole="button"
        >
          <Text style={styles.actionText}>Test alert</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            pressed && styles.pressed,
            busy && styles.disabled,
          ]}
          disabled={busy}
          onPress={() => void refresh()}
          accessibilityRole="button"
        >
          <Text style={styles.actionText}>Refresh</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            pressed && styles.pressed,
          ]}
          onPress={() => void Linking.openSettings()}
          accessibilityRole="button"
        >
          <Text style={styles.actionText}>App settings</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            pressed && styles.pressed,
            busy && styles.disabled,
          ]}
          disabled={busy}
          onPress={() => void clearLogs()}
          accessibilityRole="button"
        >
          <Text style={styles.actionText}>Clear</Text>
        </Pressable>
      </View>

      <View style={styles.console}>
        {entries.length === 0 ? (
          <Text style={styles.empty}>
            No push events recorded. Send a Home Assistant message, then tap
            Refresh.
          </Text>
        ) : (
          entries.slice(0, 40).map((entry) => (
            <View key={entry.id} style={styles.entry}>
              <View style={styles.entryHeading}>
                <Text style={styles.timestamp}>
                  {new Date(entry.timestamp).toLocaleString()}
                </Text>
                <Text style={[styles.level, { color: levelColor(entry.level) }]}>
                  {entry.level.toUpperCase()}
                </Text>
              </View>
              <Text style={styles.event} selectable>
                {entry.event}
              </Text>
              {entry.detail ? (
                <Text style={styles.detail} selectable>
                  {entry.detail}
                </Text>
              ) : null}
            </View>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.bgSurface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  heading: {
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
  title: {
    color: colors.textPrimary,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.bold,
  },
  count: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    backgroundColor: colors.bgElevated,
  },
  description: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    lineHeight: 19,
  },
  keyStatus: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  keyLabel: { color: colors.textSecondary, fontSize: fontSizes.sm },
  keyValue: { fontSize: fontSizes.sm, fontWeight: fontWeights.semibold },
  warning: { color: colors.warning, fontSize: fontSizes.sm, lineHeight: 19 },
  keyEditor: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  input: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    color: colors.textPrimary,
    backgroundColor: colors.bgElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: fontSizes.sm,
  },
  compactButton: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  compactButtonText: {
    color: colors.accent,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  actionButton: {
    minHeight: 38,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.bgElevated,
  },
  actionText: {
    color: colors.textSecondary,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
  },
  console: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.bgPrimary,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  empty: { color: colors.textMuted, fontSize: fontSizes.xs, lineHeight: 17 },
  entry: {
    gap: 3,
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  entryHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  timestamp: { color: colors.textMuted, fontSize: 10, fontFamily: "monospace" },
  level: { fontSize: 10, fontWeight: fontWeights.bold },
  event: {
    color: colors.textPrimary,
    fontSize: fontSizes.xs,
    fontFamily: "monospace",
  },
  detail: {
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 15,
    fontFamily: "monospace",
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});

import type { Device } from "@podwaffle/contracts";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { api, createCommandId } from "../api/client";
import { playbackController } from "../playback/controller";
import { useAuthStore } from "../stores/auth";
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
} from "../styles/tokens";
import { Icon } from "./Icon";

export function PlaybackDeviceModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const credentials = useAuthStore((state) => state.credentials);
  const session = useAuthStore((state) => state.session);
  const playback = useAuthStore((state) => state.snapshot?.playback ?? null);
  const refresh = useAuthStore((state) => state.refresh);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !credentials) return;
    let cancelled = false;
    setLoading(true);
    void api
      .devices(credentials.serverUrl, credentials.token)
      .then((items) => {
        if (!cancelled) setDevices(items);
      })
      .catch((error) => {
        if (!cancelled) {
          Alert.alert(
            "Playback devices",
            error instanceof Error
              ? error.message
              : "Devices could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, credentials]);

  const ordered = useMemo(
    () =>
      [...devices].sort((a, b) => {
        const rank = (device: Device) => {
          if (device.current) return 0;
          if (device.id === playback?.activeDeviceId) return 1;
          if (Date.now() - Date.parse(device.lastSeenAt) < 5 * 60_000) return 2;
          return 3;
        };
        return rank(a) - rank(b) || a.name.localeCompare(b.name);
      }),
    [devices, playback?.activeDeviceId],
  );

  async function selectDevice(device: Device) {
    if (!credentials || !playback?.episode) return;
    const connected =
      device.current ||
      Date.now() - Date.parse(device.lastSeenAt) < 5 * 60_000;
    if (!connected) return;
    setBusyId(device.id);
    try {
      if (device.current) {
        if (!playback.ownedByCurrentDevice) {
          await playbackController.takeOverPlayback();
        }
      } else {
        const result = await api.playbackCommand(
          credentials.serverUrl,
          credentials.token,
          {
            commandId: createCommandId(),
            action: "play-episode",
            episodeId: playback.episode.id,
            positionMs: playback.positionMs,
            targetDeviceId: device.id,
          },
        );
        if (result.status === "pending" && !result.delivered) {
          throw new Error(`${device.name} is not connected to live sync.`);
        }
      }
      await refresh().catch(() => undefined);
      onClose();
    } catch (error) {
      Alert.alert(
        "Move playback",
        error instanceof Error ? error.message : "Playback could not be moved.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Play on…</Text>
              <Text style={styles.subtitle}>
                Choose a connected Podwaffle client.
              </Text>
            </View>
            <Pressable
              style={styles.close}
              onPress={onClose}
              accessibilityLabel="Close"
            >
              <Icon name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>

          {loading ? (
            <ActivityIndicator style={styles.loader} color={colors.accent} />
          ) : (
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
            >
              {ordered.map((device) => {
                const connected =
                  device.current ||
                  Date.now() - Date.parse(device.lastSeenAt) < 5 * 60_000;
                const owner = device.id === playback?.activeDeviceId;
                const selected =
                  owner && playback?.ownedByCurrentDevice === device.current;
                return (
                  <Pressable
                    key={device.id}
                    style={({ pressed }) => [
                      styles.row,
                      owner && styles.rowOwner,
                      !connected && styles.rowOffline,
                      pressed && connected && styles.rowPressed,
                    ]}
                    disabled={!connected || busyId !== null || !playback?.episode}
                    onPress={() => void selectDevice(device)}
                  >
                    <View
                      style={[
                        styles.deviceIcon,
                        owner && styles.deviceIconOwner,
                      ]}
                    >
                      <Icon
                        name={device.platform === "web" ? "discover" : "device"}
                        size={20}
                        color={owner ? colors.accent : colors.textSecondary}
                      />
                    </View>
                    <View style={styles.copy}>
                      <Text style={styles.name} numberOfLines={1}>
                        {device.current ? "This device" : device.name}
                      </Text>
                      <Text style={styles.meta} numberOfLines={1}>
                        {owner
                          ? "Current playback device"
                          : connected
                            ? "Connected"
                            : "Offline"}
                        {device.current
                          ? ` · ${session?.device.name ?? device.name}`
                          : ""}
                      </Text>
                    </View>
                    {busyId === device.id ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : selected ? (
                      <Text style={styles.playing}>Playing here</Text>
                    ) : connected ? (
                      <Text style={styles.action}>Move here</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.62)",
    justifyContent: "flex-end",
  },
  sheet: {
    maxHeight: "72%",
    backgroundColor: colors.bgSurface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingBottom: spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.bold,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    marginTop: spacing.xs,
  },
  close: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  loader: { margin: spacing.xl },
  list: { flexGrow: 0 },
  listContent: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  row: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  rowOwner: { backgroundColor: colors.accentDim },
  rowOffline: { opacity: 0.45 },
  rowPressed: { opacity: 0.7 },
  deviceIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgElevated,
  },
  deviceIconOwner: { backgroundColor: colors.accentDim },
  copy: { flex: 1, minWidth: 0 },
  name: {
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
  },
  meta: {
    color: colors.textSecondary,
    fontSize: fontSizes.xs,
    marginTop: 3,
  },
  action: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
  },
  playing: {
    color: colors.accent,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.bold,
  },
});

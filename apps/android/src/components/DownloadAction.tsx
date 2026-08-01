import type { Episode } from "@podwaffle/contracts";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { PodwaffleMediaModule } from "../native-media";
import { episodeMedia } from "../playback/media";
import { useDownloadsStore } from "../stores/downloads";
import { colors, fontSizes, fontWeights, radii, spacing } from "../styles/tokens";
import { Icon } from "./Icon";

export function DownloadAction({
  episode,
  compact = false,
}: {
  episode: Episode;
  compact?: boolean;
}) {
  const download = useDownloadsStore((state) =>
    state.items.find((item) => item.episodeId === episode.id),
  );
  const [busy, setBusy] = useState(false);

  const label =
    download?.state === "completed"
      ? "Remove download"
      : download?.state === "downloading"
        ? download.totalBytes && download.totalBytes > 0
          ? `${Math.round((download.progressBytes / download.totalBytes) * 100)}%`
          : "Downloading"
        : download?.state === "queued"
          ? "Queued"
          : download?.state === "failed"
            ? "Retry download"
            : "Download";

  async function toggle() {
    if (!episode.enclosureUrl || busy) return;
    setBusy(true);
    try {
      if (download?.state === "completed") {
        await PodwaffleMediaModule.removeDownload(episode.id);
        useDownloadsStore.getState().remove(episode.id);
      } else {
        const result = await PodwaffleMediaModule.addDownload(
          episodeMedia(episode),
          "manual",
        );
        useDownloadsStore.getState().apply(result);
      }
    } catch (error) {
      Alert.alert(
        "Download failed",
        error instanceof Error ? error.message : "The download could not be changed.",
      );
    } finally {
      setBusy(false);
    }
  }

  const disabled =
    !episode.enclosureUrl ||
    busy ||
    download?.state === "downloading" ||
    download?.state === "queued";
  const completed = download?.state === "completed";

  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        compact && styles.compactButton,
        completed && styles.completed,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
      onPress={() => void toggle()}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${episode.title}`}
    >
      {busy || download?.state === "downloading" || download?.state === "queued" ? (
        <ActivityIndicator size="small" color={colors.textSecondary} />
      ) : (
        <View style={styles.content}>
          <Icon
            name={completed ? "trash" : "download"}
            size={compact ? 18 : 17}
            color={completed ? colors.success : colors.textSecondary}
          />
          {!compact ? (
            <Text style={[styles.text, completed && styles.completedText]}>
              {label}
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  compactButton: {
    width: 36,
    height: 36,
    minHeight: 36,
    paddingHorizontal: 0,
  },
  content: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  completed: { borderColor: colors.success },
  text: {
    color: colors.textSecondary,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
  },
  completedText: { color: colors.success },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});

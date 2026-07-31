import type { Episode } from "@podwaffle/contracts";
import React, { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text } from "react-native";

import { PodwaffleMediaModule } from "../native-media";
import { episodeMedia } from "../playback/media";
import { useDownloadsStore } from "../stores/downloads";
import { colors, fontSizes, fontWeights, radii, spacing } from "../styles/tokens";

export function DownloadAction({ episode }: { episode: Episode }) {
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

  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        download?.state === "completed" && styles.completed,
        pressed && styles.pressed,
        (!episode.enclosureUrl || busy) && styles.disabled,
      ]}
      onPress={() => void toggle()}
      disabled={!episode.enclosureUrl || busy || download?.state === "downloading" || download?.state === "queued"}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${episode.title}`}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.textSecondary} />
      ) : (
        <Text style={[styles.text, download?.state === "completed" && styles.completedText]}>
          {label}
        </Text>
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

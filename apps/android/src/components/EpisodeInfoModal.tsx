import type { Episode } from "@podwaffle/contracts";
import { Image } from "expo-image";
import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
} from "../styles/tokens";
import { Icon } from "./Icon";

function textFromHtml(value: string | null): string | null {
  if (!value) return null;
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatDuration(durationMs: number | null): string | null {
  if (!durationMs || durationMs <= 0) return null;
  const totalMinutes = Math.round(durationMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function EpisodeInfoModal({
  visible,
  episode,
  loading,
  onClose,
}: {
  visible: boolean;
  episode: Episode | null;
  loading: boolean;
  onClose: () => void;
}) {
  const description = textFromHtml(episode?.descriptionHtml ?? null);
  const artworkUrl = episode?.artworkUrl ?? episode?.podcastArtworkUrl ?? null;
  const details = [
    formatDate(episode?.publishedAt ?? null),
    formatDuration(episode?.durationMs ?? null),
  ].filter((item): item is string => Boolean(item));

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
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>EPISODE INFORMATION</Text>
              <Text style={styles.heading} numberOfLines={2}>
                {episode?.title ?? "Loading episode…"}
              </Text>
            </View>
            <Pressable
              style={styles.close}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close episode information"
            >
              <Icon name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>

          {loading && !episode ? (
            <ActivityIndicator style={styles.loader} color={colors.accent} />
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.summary}>
                <View style={styles.artworkFrame}>
                  {artworkUrl ? (
                    <Image
                      source={{ uri: artworkUrl }}
                      style={styles.artwork}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                    />
                  ) : (
                    <Text style={styles.artworkFallback}>PW</Text>
                  )}
                </View>
                <View style={styles.summaryCopy}>
                  <Text style={styles.podcast} numberOfLines={2}>
                    {episode?.podcastTitle ?? "Podcast"}
                  </Text>
                  {details.length > 0 ? (
                    <Text style={styles.meta}>{details.join(" · ")}</Text>
                  ) : null}
                </View>
              </View>

              <Text style={styles.description}>
                {description ?? "No episode description is available."}
              </Text>
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
    backgroundColor: "rgba(0,0,0,0.68)",
    justifyContent: "flex-end",
  },
  sheet: {
    maxHeight: "82%",
    backgroundColor: colors.bgSurface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingBottom: spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerCopy: { flex: 1, gap: spacing.xs },
  eyebrow: {
    color: colors.accent,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
    letterSpacing: 1.1,
  },
  heading: {
    color: colors.textPrimary,
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.bold,
    lineHeight: 25,
  },
  close: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
    backgroundColor: colors.bgElevated,
  },
  loader: { margin: spacing.xxl },
  scroll: { flexGrow: 0 },
  content: { padding: spacing.lg, gap: spacing.lg },
  summary: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  artworkFrame: {
    width: 92,
    height: 92,
    borderRadius: radii.lg,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgElevated,
  },
  artwork: { width: "100%", height: "100%" },
  artworkFallback: {
    color: colors.textMuted,
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.bold,
  },
  summaryCopy: { flex: 1, gap: spacing.xs },
  podcast: {
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
  },
  meta: { color: colors.textSecondary, fontSize: fontSizes.sm },
  description: {
    color: colors.textSecondary,
    fontSize: fontSizes.md,
    lineHeight: 23,
  },
});

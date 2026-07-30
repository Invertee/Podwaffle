/**
 * Podcast Library screen — Milestone 16 will implement the full tile/list view.
 * This placeholder establishes the screen structure and visual style.
 */

import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { colors, spacing, fontSizes, fontWeights } from "../../styles/tokens";

export default function PodcastsScreen() {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Podcasts</Text>
      </View>

      <View style={styles.placeholder}>
        <Text style={styles.placeholderEmoji}>🎙️</Text>
        <Text style={styles.placeholderTitle}>Your podcast library</Text>
        <Text style={styles.placeholderBody}>
          Podcast library, tile/list toggle and drag-to-reorder ordering will
          appear here in Milestone 16.
        </Text>
        <Text style={styles.milestoneBadge}>Milestone 16</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  content: {
    padding: spacing.md,
    flexGrow: 1,
  },
  header: {
    marginBottom: spacing.lg,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.xxl,
    fontWeight: fontWeights.bold,
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xxl,
    gap: spacing.md,
  },
  placeholderEmoji: {
    fontSize: 56,
  },
  placeholderTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.semibold,
    textAlign: "center",
  },
  placeholderBody: {
    color: colors.textSecondary,
    fontSize: fontSizes.md,
    textAlign: "center",
    lineHeight: 22,
    maxWidth: 300,
  },
  milestoneBadge: {
    color: colors.accent,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    backgroundColor: colors.accentDim,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 12,
    overflow: "hidden",
  },
});

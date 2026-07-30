/**
 * In Progress screen — Milestone 17 will implement the full in-progress list.
 */

import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { colors, spacing, fontSizes, fontWeights } from "../../styles/tokens";

export default function InProgressScreen() {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>In Progress</Text>
      </View>

      <View style={styles.placeholder}>
        <Text style={styles.placeholderEmoji}>▶️</Text>
        <Text style={styles.placeholderTitle}>Episodes in progress</Text>
        <Text style={styles.placeholderBody}>
          Episodes with partial progress, sorted by most recently played, will
          appear here in Milestone 17.
        </Text>
        <Text style={styles.milestoneBadge}>Milestone 17</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: { padding: spacing.md, flexGrow: 1 },
  header: { marginBottom: spacing.lg },
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
  placeholderEmoji: { fontSize: 56 },
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

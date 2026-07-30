/**
 * Join screen — Milestone 15 will implement the full join flow.
 * This placeholder establishes the screen structure with the design style.
 */

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, spacing, fontSizes, fontWeights } from "../styles/tokens";

export default function JoinScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.logo}>🎙️</Text>
        <Text style={styles.title}>Podwaffle</Text>
        <Text style={styles.subtitle}>
          Server URL, profile selection and join-code authentication will appear
          here in Milestone 15.
        </Text>
        <Text style={styles.milestoneBadge}>Milestone 15</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.lg,
  },
  logo: {
    fontSize: 72,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSizes.xxxl,
    fontWeight: fontWeights.bold,
    letterSpacing: -0.5,
  },
  subtitle: {
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

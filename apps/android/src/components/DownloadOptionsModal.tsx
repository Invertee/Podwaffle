import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
} from "../styles/tokens";
import { Icon } from "./Icon";
import { PodcastAnalysisSettings } from "./PodcastAnalysisSettings";

export function DownloadOptionsModal({
  visible,
  podcastId,
  podcastTitle,
  onClose,
}: {
  visible: boolean;
  podcastId: string;
  podcastTitle: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessible={false}>
        <Pressable
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, spacing.lg) },
          ]}
          onPress={() => undefined}
          accessible={false}
          accessibilityViewIsModal
        >
          <View style={styles.header}>
            <View style={styles.icon}>
              <Icon name="download" size={24} color={colors.accent} />
            </View>
            <View style={styles.headerCopy}>
              <Text style={styles.heading} accessibilityRole="header">
                Download Options
              </Text>
              <Text style={styles.podcast} numberOfLines={2}>
                {podcastTitle}
              </Text>
            </View>
            <Pressable
              style={styles.close}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close Download Options"
            >
              <Icon name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
          >
            {visible ? <PodcastAnalysisSettings podcastId={podcastId} /> : null}
          </ScrollView>
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
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  icon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentDim,
    borderRadius: radii.full,
  },
  headerCopy: { flex: 1, gap: spacing.xs },
  heading: {
    color: colors.textPrimary,
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.bold,
  },
  podcast: { color: colors.textSecondary, fontSize: fontSizes.sm },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
    backgroundColor: colors.bgElevated,
  },
  scroll: { flexGrow: 0 },
  content: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
});

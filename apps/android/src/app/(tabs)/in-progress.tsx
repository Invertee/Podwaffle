import { useQuery } from "@tanstack/react-query";
import React from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { api } from "../../api/client";
import { cachedQuery } from "../../api/queryCache";
import { EpisodeCard } from "../../components/EpisodeCard";
import { useEpisodeActions } from "../../hooks/useEpisodeActions";
import { useAuthStore } from "../../stores/auth";
import {
  colors,
  fontSizes,
  fontWeights,
  spacing,
} from "../../styles/tokens";

export default function InProgressScreen() {
  const credentials = useAuthStore((state) => state.credentials);
  const connection = useAuthStore((state) => state.connection);
  const profileId = useAuthStore((state) => state.session?.profile.id ?? state.snapshot?.profile.id);
  const refreshProfile = useAuthStore((state) => state.refresh);
  const episodes = useQuery({
    queryKey: ["android-in-progress"],
    queryFn: () =>
      cachedQuery(profileId!, "in-progress", () =>
        api.inProgress(credentials!.serverUrl, credentials!.token),
      ),
    enabled: Boolean(credentials && profileId),
  });
  const actions = useEpisodeActions(async () => {
    await episodes.refetch();
  });

  async function refresh() {
    await Promise.all([refreshProfile(), episodes.refetch()]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>In Progress</Text>
        <Text style={styles.headerBody}>
          Resume partially played episodes, most recent first.
        </Text>
      </View>
      {episodes.isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.loadingText}>Loading listening progress…</Text>
        </View>
      ) : episodes.error ? (
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Progress could not be loaded</Text>
          <Text style={styles.errorBody}>
            {episodes.error instanceof Error
              ? episodes.error.message
              : "Pull down to try again."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={episodes.data ?? []}
          keyExtractor={(episode) => episode.id}
          contentContainerStyle={[
            styles.content,
            (episodes.data?.length ?? 0) === 0 && styles.emptyContent,
          ]}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshing={episodes.isRefetching || connection === "checking"}
          onRefresh={() => void refresh()}
          renderItem={({ item }) => (
            <EpisodeCard
              episode={item}
              busy={actions.busyEpisodeId === item.id}
              onPlay={actions.playEpisode}
              onTogglePlayed={actions.togglePlayed}
              onAddQueue={actions.addQueue}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptySymbol}>▶</Text>
              <Text style={styles.emptyTitle}>Nothing waiting to resume</Text>
              <Text style={styles.emptyBody}>
                Start an episode from a podcast and its progress will appear here.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  header: { padding: spacing.md, paddingBottom: spacing.sm, gap: spacing.xs },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.xxl,
    fontWeight: fontWeights.bold,
  },
  headerBody: { color: colors.textSecondary, fontSize: fontSizes.sm },
  content: { padding: spacing.md, paddingTop: spacing.sm, paddingBottom: 150 },
  emptyContent: { flexGrow: 1 },
  separator: { height: spacing.md },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
  loadingText: { color: colors.textSecondary, fontSize: fontSizes.sm },
  errorTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
    textAlign: "center",
  },
  errorBody: {
    color: colors.error,
    fontSize: fontSizes.sm,
    textAlign: "center",
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
  emptySymbol: {
    width: 72,
    height: 72,
    textAlign: "center",
    textAlignVertical: "center",
    borderRadius: 36,
    overflow: "hidden",
    backgroundColor: colors.accentDim,
    color: colors.accent,
    fontSize: 30,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.bold,
    textAlign: "center",
  },
  emptyBody: {
    color: colors.textSecondary,
    fontSize: fontSizes.md,
    lineHeight: 22,
    textAlign: "center",
  },
});

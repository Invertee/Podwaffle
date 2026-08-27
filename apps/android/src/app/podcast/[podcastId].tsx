import { stripHtml, type Podcast } from "@podwaffle/contracts";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { api } from "../../api/client";
import { cachedQuery } from "../../api/queryCache";
import { EpisodeCard } from "../../components/EpisodeCard";
import { Icon } from "../../components/Icon";
import { useEpisodeActions } from "../../hooks/useEpisodeActions";
import { useAuthStore } from "../../stores/auth";
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
} from "../../styles/tokens";

export default function PodcastScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ podcastId?: string | string[] }>();
  const podcastId = Array.isArray(params.podcastId)
    ? params.podcastId[0]
    : params.podcastId;
  const credentials = useAuthStore((state) => state.credentials);
  const profileId = useAuthStore(
    (state) => state.session?.profile.id ?? state.snapshot?.profile.id,
  );
  const cachedPodcast = useAuthStore((state) =>
    state.snapshot?.subscriptions.find((item) => item.id === podcastId),
  );
  const [refreshing, setRefreshing] = useState(false);

  const podcast = useQuery({
    queryKey: ["android-podcast", podcastId],
    queryFn: () =>
      cachedQuery(profileId!, `podcast:${podcastId}`, () =>
        api.podcast(credentials!.serverUrl, credentials!.token, podcastId!),
      ),
    enabled: Boolean(credentials && podcastId && profileId),
    initialData: cachedPodcast as Podcast | undefined,
  });
  const episodes = useQuery({
    queryKey: ["android-episodes", podcastId],
    queryFn: () =>
      cachedQuery(profileId!, `episodes:${podcastId}`, () =>
        api.episodes(credentials!.serverUrl, credentials!.token, podcastId!),
      ),
    enabled: Boolean(credentials && podcastId && profileId),
  });
  const actions = useEpisodeActions(async () => {
    await episodes.refetch();
  });

  async function manualRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([episodes.refetch(), podcast.refetch()]);
    } finally {
      setRefreshing(false);
    }
  }

  if (!podcastId) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>The podcast could not be found.</Text>
      </View>
    );
  }

  const item = podcast.data ?? cachedPodcast;
  const description = stripHtml(item?.description ?? null);

  return (
    <View style={styles.container}>
      <View style={styles.screenHeader}>
        <Pressable
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.pressed,
          ]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to podcasts"
        >
          <Icon name="back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.screenTitle} numberOfLines={1}>
          {item?.title ?? "Podcast"}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <FlatList
        data={episodes.data ?? []}
        keyExtractor={(episode) => episode.id}
        contentContainerStyle={styles.content}
        refreshing={refreshing}
        onRefresh={() => void manualRefresh()}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View style={styles.hero}>
            <View style={styles.heroTop}>
              <View style={styles.artworkFrame}>
                {item?.artworkUrl ? (
                  <Image
                    source={{ uri: item.artworkUrl }}
                    style={styles.artwork}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                ) : (
                  <Text style={styles.artworkFallback}>PW</Text>
                )}
              </View>
              <View style={styles.heroCopy}>
                <Text style={styles.title}>{item?.title ?? "Podcast"}</Text>
                <Text style={styles.author}>
                  {item?.author ?? "Unknown author"}
                </Text>
              </View>
            </View>
            {description ? (
              <Text style={styles.description} numberOfLines={5}>
                {description}
              </Text>
            ) : null}
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle}>Episodes</Text>
              <Text style={styles.count}>{episodes.data?.length ?? 0}</Text>
            </View>
            {episodes.isLoading ? (
              <ActivityIndicator size="large" color={colors.accent} />
            ) : episodes.error ? (
              <Text style={styles.error}>
                {episodes.error instanceof Error
                  ? episodes.error.message
                  : "Episodes could not be loaded."}
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item: episode }) => (
          <EpisodeCard
            episode={episode}
            showPodcast={false}
            busy={actions.busyEpisodeId === episode.id}
            onPlay={actions.playEpisode}
            onTogglePlayed={actions.togglePlayed}
            onAddQueue={actions.addQueue}
          />
        )}
        ListEmptyComponent={
          episodes.isLoading ? null : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No episodes yet</Text>
              <Text style={styles.emptyBody}>
                Pull down to refresh this podcast from the server.
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  screenHeader: {
    height: 52,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  backButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
    backgroundColor: colors.bgSurface,
  },
  screenTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
    textAlign: "center",
  },
  headerSpacer: { width: 38 },
  content: { padding: spacing.md, paddingBottom: spacing.lg },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgPrimary,
    padding: spacing.lg,
  },
  hero: { gap: spacing.md, marginBottom: spacing.md },
  heroTop: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
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
    color: colors.accent,
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.bold,
  },
  heroCopy: { flex: 1, gap: spacing.xs },
  title: {
    color: colors.textPrimary,
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.bold,
    lineHeight: 25,
  },
  author: { color: colors.accent, fontSize: fontSizes.sm },
  description: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    lineHeight: 19,
  },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.xs,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.bold,
  },
  count: {
    color: colors.textSecondary,
    fontSize: fontSizes.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    backgroundColor: colors.bgElevated,
  },
  separator: { height: spacing.xs },
  error: { color: colors.error, fontSize: fontSizes.sm, textAlign: "center" },
  empty: {
    alignItems: "center",
    paddingVertical: spacing.xxl,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
  },
  emptyBody: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    textAlign: "center",
  },
  pressed: { opacity: 0.68 },
});

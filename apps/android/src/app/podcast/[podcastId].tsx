import type { Podcast } from "@podwaffle/contracts";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams } from "expo-router";
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
  radii,
  spacing,
} from "../../styles/tokens";

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

export default function PodcastScreen() {
  const params = useLocalSearchParams<{ podcastId?: string | string[] }>();
  const podcastId = Array.isArray(params.podcastId)
    ? params.podcastId[0]
    : params.podcastId;
  const credentials = useAuthStore((state) => state.credentials);
  const profileId = useAuthStore((state) => state.session?.profile.id ?? state.snapshot?.profile.id);
  const cachedPodcast = useAuthStore((state) =>
    state.snapshot?.subscriptions.find((item) => item.id === podcastId),
  );

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

  if (!podcastId) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>The podcast could not be found.</Text>
      </View>
    );
  }

  const item = podcast.data ?? cachedPodcast;
  const description = textFromHtml(item?.description ?? null);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: item?.title ?? "Podcast" }} />
      <FlatList
        data={episodes.data ?? []}
        keyExtractor={(episode) => episode.id}
        contentContainerStyle={styles.content}
        refreshing={episodes.isRefetching || podcast.isRefetching}
        onRefresh={() => void Promise.all([episodes.refetch(), podcast.refetch()])}
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
              <Text style={styles.description} numberOfLines={6}>
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
  content: { padding: spacing.md, paddingBottom: 150 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgPrimary,
    padding: spacing.lg,
  },
  hero: { gap: spacing.md, marginBottom: spacing.lg },
  heroTop: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  artworkFrame: {
    width: 112,
    height: 112,
    borderRadius: radii.lg,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgElevated,
  },
  artwork: { width: "100%", height: "100%" },
  artworkFallback: {
    color: colors.accent,
    fontSize: fontSizes.xxl,
    fontWeight: fontWeights.bold,
  },
  heroCopy: { flex: 1, gap: spacing.sm },
  title: {
    color: colors.textPrimary,
    fontSize: fontSizes.xxl,
    fontWeight: fontWeights.bold,
    lineHeight: 30,
  },
  author: { color: colors.accent, fontSize: fontSizes.md },
  description: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    lineHeight: 20,
  },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.bold,
  },
  count: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    backgroundColor: colors.bgElevated,
  },
  separator: { height: spacing.md },
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
});

import type { DiscoveryResult } from "@podwaffle/contracts";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { api } from "../../api/client";
import {
  authenticatedConnection,
  refreshProfile,
  withProfileRevision,
} from "../../api/profileMutations";
import { useAuthStore } from "../../stores/auth";
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
} from "../../styles/tokens";

export default function DiscoverScreen() {
  const credentials = useAuthStore((state) => state.credentials);
  const connection = useAuthStore((state) => state.connection);
  const subscriptions = useAuthStore(
    (state) => state.snapshot?.subscriptions ?? [],
  );
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 450);
    return () => clearTimeout(timer);
  }, [query]);

  const results = useQuery({
    queryKey: ["android-discovery", debouncedQuery],
    queryFn: () =>
      api.search(credentials!.serverUrl, credentials!.token, debouncedQuery),
    enabled: Boolean(
      credentials && connection === "online" && debouncedQuery.length >= 2,
    ),
  });

  function subscriptionFor(item: DiscoveryResult) {
    return subscriptions.find(
      (subscription) =>
        subscription.feedUrl === item.feedUrl ||
        subscription.appleCollectionId === item.appleCollectionId,
    );
  }

  async function toggleSubscription(item: DiscoveryResult) {
    const existing = subscriptionFor(item);
    setBusyId(item.appleCollectionId);
    try {
      const { serverUrl, token } = authenticatedConnection();
      if (existing) {
        await withProfileRevision((revision) =>
          api.unsubscribe(serverUrl, token, existing.id, revision),
        );
      } else {
        await withProfileRevision((revision) =>
          api.subscribe(serverUrl, token, item, revision),
        );
      }
      await refreshProfile();
      await results.refetch();
    } catch (error) {
      Alert.alert(
        existing ? "Unsubscribe failed" : "Subscription failed",
        error instanceof Error
          ? error.message
          : "The subscription could not be changed.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Discover</Text>
        <Text style={styles.headerBody}>
          Search Apple Podcasts and add shows to your Podwaffle library.
        </Text>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Shows, people, or topics"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={styles.input}
            accessibilityLabel="Search podcasts"
          />
          {results.isFetching ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : query.length > 0 ? (
            <Pressable
              onPress={() => setQuery("")}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={10}
            >
              <Text style={styles.clear}>×</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {connection !== "online" ? (
        <View style={styles.offline}>
          <Text style={styles.offlineText}>
            Podcast search requires a connection to your Podwaffle server.
          </Text>
        </View>
      ) : null}

      <FlatList
        data={results.data ?? []}
        keyExtractor={(item) => item.appleCollectionId || item.feedUrl}
        contentContainerStyle={[
          styles.content,
          (results.data?.length ?? 0) === 0 && styles.emptyContent,
        ]}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item }) => {
          const existing = subscriptionFor(item);
          const busy = busyId === item.appleCollectionId;
          return (
            <View style={styles.result}>
              <View style={styles.artworkFrame}>
                {item.artworkUrl ? (
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
              <View style={styles.copy}>
                <Text style={styles.title} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={styles.author} numberOfLines={1}>
                  {item.author ?? "Unknown author"}
                </Text>
                {item.genre ? (
                  <Text style={styles.genre} numberOfLines={1}>
                    {item.genre}
                  </Text>
                ) : null}
              </View>
              <Pressable
                style={({ pressed }) => [
                  styles.subscribeButton,
                  existing && styles.subscribedButton,
                  pressed && styles.pressed,
                  busy && styles.disabled,
                ]}
                disabled={busy}
                onPress={() => void toggleSubscription(item)}
                accessibilityRole="button"
                accessibilityLabel={
                  existing
                    ? `Unsubscribe from ${item.title}`
                    : `Subscribe to ${item.title}`
                }
              >
                {busy ? (
                  <ActivityIndicator
                    size="small"
                    color={existing ? colors.accent : colors.textOnAccent}
                  />
                ) : (
                  <Text
                    style={[
                      styles.subscribeText,
                      existing && styles.subscribedText,
                    ]}
                  >
                    {existing ? "Added" : "Add"}
                  </Text>
                )}
              </Pressable>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            {results.error ? (
              <>
                <Text style={styles.emptyTitle}>Search failed</Text>
                <Text style={[styles.emptyBody, styles.errorText]}>
                  {results.error instanceof Error
                    ? results.error.message
                    : "The search could not be completed."}
                </Text>
              </>
            ) : debouncedQuery.length < 2 ? (
              <>
                <Text style={styles.emptySymbol}>⌕</Text>
                <Text style={styles.emptyTitle}>Find a podcast</Text>
                <Text style={styles.emptyBody}>
                  Enter at least two characters. Results update automatically as
                  you type.
                </Text>
              </>
            ) : results.isFetching ? (
              <ActivityIndicator size="large" color={colors.accent} />
            ) : (
              <>
                <Text style={styles.emptyTitle}>No podcasts found</Text>
                <Text style={styles.emptyBody}>
                  Try a show title, presenter, or broader topic.
                </Text>
              </>
            )}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  header: { padding: spacing.md, gap: spacing.sm },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: fontSizes.xxl,
    fontWeight: fontWeights.bold,
  },
  headerBody: { color: colors.textSecondary, fontSize: fontSizes.sm, lineHeight: 19 },
  searchBox: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSurface,
  },
  searchIcon: { color: colors.textMuted, fontSize: 24 },
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    paddingVertical: spacing.sm,
  },
  clear: { color: colors.textSecondary, fontSize: 26 },
  offline: {
    marginHorizontal: spacing.md,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.skipDim,
  },
  offlineText: {
    color: colors.warning,
    fontSize: fontSizes.sm,
    textAlign: "center",
  },
  content: { padding: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  emptyContent: { flexGrow: 1 },
  separator: { height: spacing.sm },
  result: {
    minHeight: 92,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSurface,
  },
  artworkFrame: {
    width: 70,
    height: 70,
    borderRadius: radii.md,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgElevated,
  },
  artwork: { width: "100%", height: "100%" },
  artworkFallback: {
    color: colors.textMuted,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.bold,
  },
  copy: { flex: 1, gap: 3 },
  title: {
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
    lineHeight: 20,
  },
  author: { color: colors.textSecondary, fontSize: fontSizes.sm },
  genre: { color: colors.textMuted, fontSize: fontSizes.xs },
  subscribeButton: {
    minWidth: 64,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.full,
    backgroundColor: colors.accent,
  },
  subscribedButton: {
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  subscribeText: {
    color: colors.textOnAccent,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.bold,
  },
  subscribedText: { color: colors.accent },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
  emptySymbol: {
    color: colors.accent,
    fontSize: 64,
    lineHeight: 72,
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
  errorText: { color: colors.error },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});

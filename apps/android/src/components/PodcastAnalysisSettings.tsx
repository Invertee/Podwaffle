import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AnalysisSettings } from "@podwaffle/contracts";
import { ActivityIndicator, Pressable, Switch, Text, View } from "react-native";
import { api } from "../api/client";
import { useAuthStore } from "../stores/auth";
import { colors, spacing } from "../styles/tokens";

export function PodcastAnalysisSettings({ podcastId }: { podcastId: string }) {
  const credentials = useAuthStore((state) => state.credentials);
  const profileId = useAuthStore((state) => state.session?.profile.id);
  const online = useAuthStore((state) => state.connection === "online");
  const client = useQueryClient();
  const key = ["android-analysis-settings", profileId, podcastId];
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      api.analysisSettings(
        credentials!.serverUrl,
        credentials!.token,
        podcastId,
      ),
    enabled: Boolean(credentials && online),
  });
  const save = useMutation({
    mutationFn: (settings: AnalysisSettings) =>
      api.saveAnalysisSettings(
        credentials!.serverUrl,
        credentials!.token,
        podcastId,
        settings,
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: key });
    },
  });
  const settings = query.data?.settings;
  if (!settings)
    return (
      <View style={{ gap: spacing.sm, paddingVertical: spacing.lg }}>
        {!online ? (
          <Text style={{ color: colors.textSecondary }}>
            Connect to the server to manage download options.
          </Text>
        ) : query.isError ? (
          <>
            <Text style={{ color: colors.warning }}>
              Download options could not be loaded.
            </Text>
            <Pressable
              onPress={() => void query.refetch()}
              accessibilityRole="button"
              accessibilityLabel="Retry loading download options"
              style={{ paddingVertical: spacing.sm }}
            >
              <Text style={{ color: colors.accent }}>Try again</Text>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator
            color={colors.accent}
            accessibilityLabel="Loading download options"
          />
        )}
      </View>
    );
  return (
    <View style={{ gap: spacing.sm, paddingVertical: spacing.md }}>
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}
      >
        <Text style={{ color: colors.textPrimary, flex: 1 }}>
          Analyse and download new episodes
        </Text>
        <Switch
          value={settings.enabled}
          disabled={!online || save.isPending || !query.data?.configured}
          accessibilityLabel="Analyse and download new episodes"
          onValueChange={(enabled) => save.mutate({ ...settings, enabled })}
        />
      </View>
      <Text style={{ color: colors.textMuted }}>
        Checked audio downloads automatically on Wi-Fi. Other episodes stream
        from the publisher.
      </Text>
      {!online && (
        <Text style={{ color: colors.textSecondary }}>
          Connect to the server to change these options.
        </Text>
      )}
      {!query.data?.configured && (
        <Text style={{ color: colors.textSecondary }}>
          Audio analysis is not configured on the server.
        </Text>
      )}
      {settings.enabled && (
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          {(["low", "balanced", "high"] as const).map((sensitivity) => (
            <Pressable
              key={sensitivity}
              disabled={!online || save.isPending || !query.data?.configured}
              accessibilityRole="button"
              accessibilityState={{
                selected: settings.sensitivity === sensitivity,
              }}
              onPress={() => save.mutate({ ...settings, sensitivity })}
              style={{
                padding: spacing.sm,
                borderWidth: 1,
                borderRadius: 8,
                borderColor:
                  settings.sensitivity === sensitivity
                    ? colors.accent
                    : colors.borderSubtle,
              }}
            >
              <Text style={{ color: colors.textPrimary }}>{sensitivity}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {save.error && (
        <Text style={{ color: colors.warning }}>{save.error.message}</Text>
      )}
    </View>
  );
}

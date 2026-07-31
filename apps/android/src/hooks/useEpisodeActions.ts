import type { Episode } from "@podwaffle/contracts";
import { useState } from "react";
import { Alert } from "react-native";

import { api } from "../api/client";
import {
  authenticatedConnection,
  refreshProfile,
  withProfileRevision,
} from "../api/profileMutations";
import { playbackController } from "../playback/controller";

function showError(error: unknown): void {
  Alert.alert(
    "Podwaffle",
    error instanceof Error ? error.message : "The action could not be completed.",
  );
}

export function useEpisodeActions(onChanged?: () => void | Promise<void>) {
  const [busyEpisodeId, setBusyEpisodeId] = useState<string | null>(null);

  async function run(episodeId: string, operation: () => Promise<void>) {
    setBusyEpisodeId(episodeId);
    try {
      await operation();
    } catch (error) {
      showError(error);
    } finally {
      setBusyEpisodeId(null);
    }
  }

  return {
    busyEpisodeId,

    playEpisode: (episode: Episode) =>
      run(episode.id, async () => {
        await playbackController.playEpisode(episode);
      }),

    togglePlayed: (episode: Episode) =>
      run(episode.id, async () => {
        const { serverUrl, token } = authenticatedConnection();
        await withProfileRevision((revision) =>
          api.setPlayed(
            serverUrl,
            token,
            episode.id,
            !episode.played,
            revision,
          ),
        );
        await refreshProfile();
        await onChanged?.();
      }),

    addQueue: (episode: Episode, position: "next" | "bottom") =>
      run(episode.id, async () => {
        const { serverUrl, token } = authenticatedConnection();
        await withProfileRevision((revision) =>
          api.addQueue(serverUrl, token, episode.id, position, revision),
        );
        await refreshProfile();
        await onChanged?.();
      }),
  };
}

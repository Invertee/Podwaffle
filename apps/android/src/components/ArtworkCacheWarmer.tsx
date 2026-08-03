import React, { useEffect, useMemo } from "react";

import { warmArtworkCache } from "../api/artworkCache";
import { useAuthStore } from "../stores/auth";

export function ArtworkCacheWarmer() {
  const connection = useAuthStore((state) => state.connection);
  const subscriptions = useAuthStore((state) => state.snapshot?.subscriptions);
  const queue = useAuthStore((state) => state.snapshot?.queue);
  const playbackEpisode = useAuthStore(
    (state) => state.snapshot?.playback?.episode,
  );

  const artworkUrls = useMemo(
    () => [
      ...(subscriptions ?? []).map((podcast) => podcast.artworkUrl),
      ...(queue ?? []).flatMap((item) => [
        item.episode.podcastArtworkUrl,
        item.episode.artworkUrl,
      ]),
      playbackEpisode?.podcastArtworkUrl,
      playbackEpisode?.artworkUrl,
    ],
    [playbackEpisode, queue, subscriptions],
  );
  const signature = artworkUrls.filter(Boolean).join("\n");

  useEffect(() => {
    if (connection !== "online" || !signature) return;
    void warmArtworkCache(artworkUrls);
  }, [connection, signature]);

  return null;
}

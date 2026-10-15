import type { Episode } from "@podwaffle/contracts";

import type { NativeEpisodeMedia } from "../native-media";
import { useAuthStore } from "../stores/auth";
import { downloadedPath } from "../stores/downloads";
import { useDownloadsStore } from "../stores/downloads";

export function episodeMedia(
  episode: Episode,
  queueItemId: string | null = null,
): NativeEpisodeMedia {
  if (!episode.enclosureUrl) {
    throw new Error("This episode does not have a playable audio enclosure.");
  }
  const podcastArtworkUrl =
    episode.podcastArtworkUrl ??
    useAuthStore
      .getState()
      .snapshot?.subscriptions.find(
        (podcast) => podcast.id === episode.podcastId,
      )?.artworkUrl ??
    episode.artworkUrl;
  const download = useDownloadsStore
    .getState()
    .items.find(
      (item) => item.episodeId === episode.id && item.state === "completed",
    );
  const analysed = episode.analysedMedia;
  const serverUrl = useAuthStore.getState().credentials?.serverUrl;
  return {
    episodeId: episode.id,
    podcastId: episode.podcastId,
    title: episode.title,
    podcastTitle: episode.podcastTitle,
    enclosureUrl: episode.enclosureUrl,
    analysedUrl: download
      ? (download.analysedUrl ?? null)
      : analysed && serverUrl
        ? `${serverUrl}${analysed.path}`
        : null,
    analysisSha256: download
      ? (download.analysisSha256 ?? null)
      : (analysed?.sha256 ?? null),
    adSegments: download
      ? (download.adSegments ?? [])
      : (analysed?.adSegments ?? []),
    enclosureType: episode.enclosureType,
    localDownloadPath: downloadedPath(episode.id),
    artworkUrl: podcastArtworkUrl,
    durationMs:
      download?.durationMs ?? analysed?.durationMs ?? episode.durationMs,
    queueItemId,
    resumePositionMs: episode.played ? 0 : episode.positionMs,
  };
}

import type { Episode } from "@podwaffle/contracts";

import type { NativeEpisodeMedia } from "../native-media";
import { downloadedPath } from "../stores/downloads";

export function episodeMedia(
  episode: Episode,
  queueItemId: string | null = null,
): NativeEpisodeMedia {
  if (!episode.enclosureUrl) {
    throw new Error("This episode does not have a playable audio enclosure.");
  }
  return {
    episodeId: episode.id,
    podcastId: episode.podcastId,
    title: episode.title,
    podcastTitle: episode.podcastTitle,
    enclosureUrl: episode.enclosureUrl,
    enclosureType: episode.enclosureType,
    localDownloadPath: downloadedPath(episode.id),
    artworkUrl: episode.artworkUrl,
    durationMs: episode.durationMs,
    queueItemId,
  };
}

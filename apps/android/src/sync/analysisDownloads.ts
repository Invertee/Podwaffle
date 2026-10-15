import { ApiClientError, api } from "../api/client";
import { PodwaffleMediaModule } from "../native-media";
import { episodeMedia } from "../playback/media";
import { useAuthStore } from "../stores/auth";
import { useDownloadsStore } from "../stores/downloads";

let pending: Promise<void> | null = null;
export function downloadAnalysedEpisodes(): Promise<void> {
  if (pending) return pending;
  pending = (async () => {
    const credentials = useAuthStore.getState().credentials;
    if (!credentials) return;
    const episodes = await api
      .analysedDownloads(credentials.serverUrl, credentials.token)
      .catch((error: unknown) => {
        // Older servers do not expose analysis downloads. Their sync and playback
        // flows stay available while the client and server are upgraded separately.
        if (error instanceof ApiClientError && error.status === 404) return [];
        throw error;
      });
    for (const episode of episodes) {
      if (useAuthStore.getState().credentials?.token !== credentials.token)
        return;
      if (!episode.analysedMedia) continue;
      // Native DownloadManager persists pending work, waits for unmetered access,
      // and deduplicates repeated Firebase, websocket and reconnect deliveries.
      const download = await PodwaffleMediaModule.addDownload(
        {
          ...episodeMedia(episode),
          analysedUrl: `${credentials.serverUrl}${episode.analysedMedia.path}`,
          analysisSha256: episode.analysedMedia.sha256,
          adSegments: episode.analysedMedia.adSegments,
        },
        "automatic",
      );
      useDownloadsStore.getState().apply(download);
    }
  })().finally(() => {
    pending = null;
  });
  return pending;
}

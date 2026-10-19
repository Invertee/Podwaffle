import { ApiClientError, api } from "../api/client";
import { PodwaffleMediaModule } from "../native-media";
import { episodeMedia } from "../playback/media";
import { useAuthStore } from "../stores/auth";
import { useDownloadsStore } from "../stores/downloads";

let pending: Promise<void> | null = null;
let checkRequested = false;
export function downloadAnalysedEpisodes(): Promise<void> {
  checkRequested = true;
  if (pending) {
    // A completion received during an older REST request may refer to an
    // episode that request could not see. Drain it, including at promise exit.
    return pending.then(
      () => (checkRequested ? downloadAnalysedEpisodes() : undefined),
      (error: unknown) => {
        if (checkRequested) return downloadAnalysedEpisodes();
        throw error;
      },
    );
  }
  pending = (async () => {
    do {
      checkRequested = false;
      await downloadReadyEpisodes();
    } while (checkRequested);
  })().finally(() => {
    pending = null;
  });
  return pending;
}

async function downloadReadyEpisodes(): Promise<void> {
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
  const sameSession = () => {
    const current = useAuthStore.getState().credentials;
    return (
      current?.token === credentials.token &&
      current.serverUrl === credentials.serverUrl
    );
  };
  let downloadError: Error | undefined;
  for (const episode of episodes) {
    if (!sameSession()) return;
    if (!episode.analysedMedia) continue;
    // Native DownloadManager persists pending work, waits for unmetered access,
    // and deduplicates repeated Firebase, websocket and reconnect deliveries.
    try {
      const download = await PodwaffleMediaModule.addDownload(
        {
          ...episodeMedia(episode),
          analysedUrl: `${credentials.serverUrl}${episode.analysedMedia.path}`,
          analysisSha256: episode.analysedMedia.sha256,
          adSegments: episode.analysedMedia.adSegments,
        },
        "automatic",
      );
      if (!sameSession()) return;
      useDownloadsStore.getState().apply(download);
    } catch (error) {
      // One bad entry must not prevent other completed episodes downloading.
      downloadError ??=
        error instanceof Error
          ? error
          : new Error("An analysed episode could not be queued for download.");
    }
  }
  if (downloadError) throw downloadError;
}

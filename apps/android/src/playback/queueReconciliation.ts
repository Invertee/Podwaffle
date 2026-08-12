import type { QueueItem, Snapshot } from "@podwaffle/contracts";

import type { PendingPlaybackUpdate } from "./offlineProgress";

export function pendingCompletionEpisodeIds(
  pending: PendingPlaybackUpdate[],
  completedEpisodeId: string | null,
): Set<string> {
  const completed = new Set(
    pending
      .filter((update) => update.completed)
      .map((update) => update.episodeId),
  );
  if (completedEpisodeId) completed.add(completedEpisodeId);
  return completed;
}

export function queueWithoutPendingCompletions(
  queue: QueueItem[],
  pending: PendingPlaybackUpdate[],
  completedEpisodeId: string | null,
): QueueItem[] {
  const completed = pendingCompletionEpisodeIds(pending, completedEpisodeId);
  return queue.filter((item) => !completed.has(item.episode.id));
}

export function snapshotWithoutCompletedEpisodes(
  snapshot: Snapshot,
  completedEpisodeIds: Iterable<string>,
): Snapshot {
  const completed = new Set(completedEpisodeIds);
  if (completed.size === 0) return snapshot;
  const queue = snapshot.queue.filter(
    (item) => !completed.has(item.episode.id),
  );
  const playback =
    snapshot.playback?.episode && completed.has(snapshot.playback.episode.id)
      ? null
      : snapshot.playback;
  if (
    queue.length === snapshot.queue.length &&
    playback === snapshot.playback
  ) {
    return snapshot;
  }
  return { ...snapshot, queue, playback };
}

export function snapshotWithoutPendingCompletions(
  snapshot: Snapshot,
  pending: PendingPlaybackUpdate[],
  completedEpisodeId: string | null,
): Snapshot {
  return snapshotWithoutCompletedEpisodes(
    snapshot,
    pendingCompletionEpisodeIds(pending, completedEpisodeId),
  );
}

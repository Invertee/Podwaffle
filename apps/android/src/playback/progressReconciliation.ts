import type { Episode } from "@podwaffle/contracts";

import type { PendingPlaybackUpdate } from "./offlineProgress";

export const PROGRESS_RECONCILIATION_TOLERANCE_MS = 5_000;

export function resumePositionMs(
  savedPositionMs: number,
  nativePositionMs: number,
): number {
  const saved = Math.max(0, savedPositionMs);
  const native = Math.max(0, nativePositionMs);
  return saved - native > PROGRESS_RECONCILIATION_TOLERANCE_MS
    ? saved
    : native;
}

export function pendingProgressIsStale(
  update: PendingPlaybackUpdate,
  serverEpisode: Episode,
): boolean {
  if (update.completed || update.allowRegression === true) return false;
  if (serverEpisode.played) return true;
  return (
    serverEpisode.positionMs - update.positionMs >
    PROGRESS_RECONCILIATION_TOLERANCE_MS
  );
}

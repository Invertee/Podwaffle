import type { Snapshot } from "@podwaffle/contracts";

export const QUEUE_INACTIVITY_MS = 3 * 24 * 60 * 60 * 1_000;

export function snapshotWithoutIdleQueue(
  snapshot: Snapshot,
  now = Date.now(),
): Snapshot {
  if (snapshot.queue.length === 0) return snapshot;
  const recordedActivity = Date.parse(snapshot.queueLastActivityAt ?? "");
  const lastActivity = Number.isFinite(recordedActivity)
    ? recordedActivity
    : Math.max(...snapshot.queue.map((item) => Date.parse(item.addedAt)));
  if (
    !Number.isFinite(lastActivity) ||
    now - lastActivity < QUEUE_INACTIVITY_MS
  )
    return snapshot;
  return { ...snapshot, queue: [], playback: null };
}

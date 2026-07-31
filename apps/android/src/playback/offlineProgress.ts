import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "podwaffle.pending-playback.v1";

export interface PendingPlaybackUpdate {
  episodeId: string;
  positionMs: number;
  durationMs: number | null;
  state: "playing" | "paused" | "stopped";
  playbackRate: number;
  completed: boolean;
  updatedAt: string;
}

function key(profileId: string): string {
  return `${PREFIX}:${profileId}`;
}

export async function pendingPlaybackUpdates(
  profileId: string,
): Promise<PendingPlaybackUpdate[]> {
  try {
    const raw = await AsyncStorage.getItem(key(profileId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingPlaybackUpdate[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) =>
        typeof item?.episodeId === "string" &&
        Number.isFinite(item.positionMs) &&
        Number.isFinite(item.playbackRate),
    );
  } catch {
    return [];
  }
}

export async function savePendingPlayback(
  profileId: string,
  update: Omit<PendingPlaybackUpdate, "updatedAt">,
): Promise<void> {
  const pending = await pendingPlaybackUpdates(profileId);
  const prior = pending.find((item) => item.episodeId === update.episodeId);
  const next: PendingPlaybackUpdate = {
    ...update,
    positionMs: Math.max(update.positionMs, prior?.positionMs ?? 0),
    completed: update.completed || prior?.completed === true,
    updatedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(
    key(profileId),
    JSON.stringify([
      ...pending.filter((item) => item.episodeId !== update.episodeId),
      next,
    ]),
  );
}

export async function removePendingPlayback(
  profileId: string,
  episodeId: string,
): Promise<void> {
  const pending = await pendingPlaybackUpdates(profileId);
  const next = pending.filter((item) => item.episodeId !== episodeId);
  if (next.length === 0) {
    await AsyncStorage.removeItem(key(profileId));
  } else {
    await AsyncStorage.setItem(key(profileId), JSON.stringify(next));
  }
}

export async function clearPendingPlayback(profileId: string): Promise<void> {
  await AsyncStorage.removeItem(key(profileId));
}

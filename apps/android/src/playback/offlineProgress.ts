import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "podwaffle.pending-playback.v1";
const pendingMutations = new Map<string, Promise<void>>();

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

async function readPendingPlayback(
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

async function serializePendingMutation<T>(
  profileId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const prior = pendingMutations.get(profileId) ?? Promise.resolve();
  const run = prior.then(operation, operation);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  pendingMutations.set(profileId, tail);
  try {
    return await run;
  } finally {
    if (pendingMutations.get(profileId) === tail) {
      pendingMutations.delete(profileId);
    }
  }
}

export async function pendingPlaybackUpdates(
  profileId: string,
): Promise<PendingPlaybackUpdate[]> {
  return serializePendingMutation(profileId, () =>
    readPendingPlayback(profileId),
  );
}

export async function savePendingPlayback(
  profileId: string,
  update: Omit<PendingPlaybackUpdate, "updatedAt">,
): Promise<void> {
  await serializePendingMutation(profileId, async () => {
    const pending = await readPendingPlayback(profileId);
    const prior = pending.find((item) => item.episodeId === update.episodeId);
    const completed = update.completed || prior?.completed === true;
    const next: PendingPlaybackUpdate = {
      ...update,
      positionMs: Math.max(update.positionMs, prior?.positionMs ?? 0),
      durationMs: update.durationMs ?? prior?.durationMs ?? null,
      state: completed ? "stopped" : update.state,
      completed,
      updatedAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(
      key(profileId),
      JSON.stringify([
        ...pending.filter((item) => item.episodeId !== update.episodeId),
        next,
      ]),
    );
  });
}

export async function removePendingPlayback(
  profileId: string,
  episodeId: string,
): Promise<void> {
  await serializePendingMutation(profileId, async () => {
    const pending = await readPendingPlayback(profileId);
    const next = pending.filter((item) => item.episodeId !== episodeId);
    if (next.length === 0) {
      await AsyncStorage.removeItem(key(profileId));
    } else {
      await AsyncStorage.setItem(key(profileId), JSON.stringify(next));
    }
  });
}

export async function clearPendingPlayback(profileId: string): Promise<void> {
  await serializePendingMutation(profileId, () =>
    AsyncStorage.removeItem(key(profileId)),
  );
}

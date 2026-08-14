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
  allowRegression?: boolean;
  updatedAt: string;
}

function key(profileId: string): string {
  return `${PREFIX}:${profileId}`;
}

function samePendingUpdate(
  current: PendingPlaybackUpdate,
  expected: PendingPlaybackUpdate,
): boolean {
  return (
    current.episodeId === expected.episodeId &&
    current.positionMs === expected.positionMs &&
    current.durationMs === expected.durationMs &&
    current.state === expected.state &&
    current.playbackRate === expected.playbackRate &&
    current.completed === expected.completed &&
    current.allowRegression === expected.allowRegression &&
    current.updatedAt === expected.updatedAt
  );
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
): Promise<PendingPlaybackUpdate> {
  return serializePendingMutation(profileId, async () => {
    const pending = await readPendingPlayback(profileId);
    const prior = pending.find((item) => item.episodeId === update.episodeId);
    const completed = update.completed || prior?.completed === true;
    const allowRegression =
      !completed &&
      (update.allowRegression === true || prior?.allowRegression === true);
    const next: PendingPlaybackUpdate = {
      ...update,
      positionMs:
        update.allowRegression === true
          ? update.positionMs
          : Math.max(update.positionMs, prior?.positionMs ?? 0),
      durationMs: update.durationMs ?? prior?.durationMs ?? null,
      state: completed ? "stopped" : update.state,
      completed,
      ...(allowRegression ? { allowRegression: true } : {}),
      updatedAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(
      key(profileId),
      JSON.stringify([
        ...pending.filter((item) => item.episodeId !== update.episodeId),
        next,
      ]),
    );
    return next;
  });
}

export async function acknowledgePendingPlayback(
  profileId: string,
  expected: PendingPlaybackUpdate,
): Promise<boolean> {
  return serializePendingMutation(profileId, async () => {
    const pending = await readPendingPlayback(profileId);
    const current = pending.find(
      (item) => item.episodeId === expected.episodeId,
    );
    if (!current || !samePendingUpdate(current, expected)) return false;
    const next = pending.filter(
      (item) => item.episodeId !== expected.episodeId,
    );
    if (next.length === 0) {
      await AsyncStorage.removeItem(key(profileId));
    } else {
      await AsyncStorage.setItem(key(profileId), JSON.stringify(next));
    }
    return true;
  });
}

export async function clearPendingCompletion(
  profileId: string,
  episodeId: string,
): Promise<boolean> {
  return serializePendingMutation(profileId, async () => {
    const pending = await readPendingPlayback(profileId);
    const current = pending.find((item) => item.episodeId === episodeId);
    if (!current?.completed) return false;
    const next = pending.filter((item) => item.episodeId !== episodeId);
    if (next.length === 0) {
      await AsyncStorage.removeItem(key(profileId));
    } else {
      await AsyncStorage.setItem(key(profileId), JSON.stringify(next));
    }
    return true;
  });
}

export async function clearPendingPlayback(profileId: string): Promise<void> {
  await serializePendingMutation(profileId, () =>
    AsyncStorage.removeItem(key(profileId)),
  );
}

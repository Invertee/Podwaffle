import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "podwaffle.query-cache.v2";
const LEGACY_PREFIX = "podwaffle.query-cache.v1";
const EPISODE_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1_000;
const CACHE_WARM_WORKERS = 3;
const MAX_CACHE_BYTES = 4_500_000;
const MAX_CACHE_ENTRIES = 40;
const MAX_CACHED_EPISODES = 150;
const MAX_SINGLE_ENTRY_BYTES = 900_000;

interface CacheRecord<T> {
  savedAt: number;
  value: T;
}

let writeQueue: Promise<void> = Promise.resolve();
let legacyCacheCleared = false;

function cacheKey(profileId: string, key: string, prefix = PREFIX): string {
  return `${prefix}:${profileId}:${key}`;
}

function compactValue<T>(key: string, value: T): T {
  if (!key.startsWith("episodes:") || !Array.isArray(value)) return value;
  return value.slice(0, MAX_CACHED_EPISODES).map((item) => {
    if (!item || typeof item !== "object") return item;
    return { ...item, descriptionHtml: null };
  }) as T;
}

async function clearLegacyCacheOnce(): Promise<void> {
  if (legacyCacheCleared) return;
  const keys = await AsyncStorage.getAllKeys();
  const legacy = keys.filter((key) => key.startsWith(`${LEGACY_PREFIX}:`));
  if (legacy.length > 0) await AsyncStorage.multiRemove(legacy);
  legacyCacheCleared = true;
}

async function pruneCache(requiredBytes: number, preserveKey: string): Promise<void> {
  const keys = (await AsyncStorage.getAllKeys()).filter(
    (key) => key.startsWith(`${PREFIX}:`) && key !== preserveKey,
  );
  if (keys.length === 0) return;

  const records = (await AsyncStorage.multiGet(keys))
    .map(([key, raw]) => {
      if (!raw) return null;
      let savedAt = 0;
      try {
        const parsed = JSON.parse(raw) as Partial<CacheRecord<unknown>>;
        savedAt = typeof parsed.savedAt === "number" ? parsed.savedAt : 0;
      } catch {
        // Malformed entries are the first candidates for removal.
      }
      return { key, bytes: raw.length, savedAt };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => a.savedAt - b.savedAt);

  let totalBytes = records.reduce((total, entry) => total + entry.bytes, 0);
  let totalEntries = records.length + 1;
  const removals: string[] = [];
  for (const entry of records) {
    if (
      totalBytes + requiredBytes <= MAX_CACHE_BYTES &&
      totalEntries <= MAX_CACHE_ENTRIES
    ) {
      break;
    }
    removals.push(entry.key);
    totalBytes -= entry.bytes;
    totalEntries -= 1;
  }
  if (removals.length > 0) await AsyncStorage.multiRemove(removals);
}

async function writeCache<T>(
  profileId: string,
  key: string,
  value: T,
): Promise<void> {
  const compacted = compactValue(key, value);
  const raw = JSON.stringify({
    savedAt: Date.now(),
    value: compacted,
  } satisfies CacheRecord<T>);
  if (raw.length > MAX_SINGLE_ENTRY_BYTES) return;

  const destination = cacheKey(profileId, key);
  const operation = writeQueue.then(async () => {
    await clearLegacyCacheOnce();
    await pruneCache(raw.length, destination);
    try {
      await AsyncStorage.setItem(destination, raw);
    } catch {
      const cacheKeys = (await AsyncStorage.getAllKeys()).filter(
        (candidate) => candidate.startsWith(`${PREFIX}:`) && candidate !== destination,
      );
      if (cacheKeys.length > 0) await AsyncStorage.multiRemove(cacheKeys);
      await AsyncStorage.setItem(destination, raw);
    }
  });
  writeQueue = operation.catch(() => undefined);
  await operation;
}

async function readCache<T>(profileId: string, key: string): Promise<T | null> {
  for (const prefix of [PREFIX, LEGACY_PREFIX]) {
    const raw = await AsyncStorage.getItem(cacheKey(profileId, key, prefix));
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as CacheRecord<T>;
      return parsed.value;
    } catch {
      await AsyncStorage.removeItem(cacheKey(profileId, key, prefix)).catch(
        () => undefined,
      );
    }
  }
  return null;
}

export async function cachedQuery<T>(
  profileId: string,
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  try {
    const result = await fetcher();
    void writeCache(profileId, key, result).catch(() => undefined);
    return result;
  } catch (error) {
    const cached = await readCache<T>(profileId, key);
    if (cached === null) throw error;
    return cached;
  }
}

export async function warmEpisodeCache<T>(
  profileId: string,
  podcastIds: string[],
  fetchEpisodes: (podcastId: string) => Promise<T>,
): Promise<void> {
  const uniqueIds = [...new Set(podcastIds)];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < uniqueIds.length) {
      const podcastId = uniqueIds[nextIndex++];
      if (!podcastId) continue;
      const key = `episodes:${podcastId}`;
      try {
        const raw = await AsyncStorage.getItem(cacheKey(profileId, key));
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<CacheRecord<T>>;
          if (
            typeof parsed.savedAt === "number" &&
            Date.now() - parsed.savedAt < EPISODE_CACHE_MAX_AGE_MS
          ) {
            continue;
          }
        }
        const episodes = await fetchEpisodes(podcastId);
        await writeCache(profileId, key, episodes);
      } catch {
        // Existing cached data remains usable when warming or cache writes fail.
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(CACHE_WARM_WORKERS, uniqueIds.length) },
      () => worker(),
    ),
  );
}

export async function clearQueryCache(profileId: string): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const matching = keys.filter(
    (key) =>
      key.startsWith(`${PREFIX}:${profileId}:`) ||
      key.startsWith(`${LEGACY_PREFIX}:${profileId}:`),
  );
  if (matching.length > 0) await AsyncStorage.multiRemove(matching);
}

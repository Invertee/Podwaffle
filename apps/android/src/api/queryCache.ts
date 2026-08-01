import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "podwaffle.query-cache.v1";
const EPISODE_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1_000;
const CACHE_WARM_WORKERS = 3;

interface CacheRecord<T> {
  savedAt: number;
  value: T;
}

function cacheKey(profileId: string, key: string): string {
  return `${PREFIX}:${profileId}:${key}`;
}

async function writeCache<T>(
  profileId: string,
  key: string,
  value: T,
): Promise<void> {
  await AsyncStorage.setItem(
    cacheKey(profileId, key),
    JSON.stringify({ savedAt: Date.now(), value } satisfies CacheRecord<T>),
  );
}

export async function cachedQuery<T>(
  profileId: string,
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  try {
    const result = await fetcher();
    await writeCache(profileId, key, result);
    return result;
  } catch (error) {
    const raw = await AsyncStorage.getItem(cacheKey(profileId, key));
    if (!raw) throw error;
    const parsed = JSON.parse(raw) as CacheRecord<T>;
    return parsed.value;
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
        // Existing cached data remains usable when warming fails.
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
  const prefix = `${PREFIX}:${profileId}:`;
  const matching = keys.filter((key) => key.startsWith(prefix));
  if (matching.length > 0) await AsyncStorage.multiRemove(matching);
}

import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "podwaffle.query-cache.v1";

function cacheKey(profileId: string, key: string): string {
  return `${PREFIX}:${profileId}:${key}`;
}

export async function cachedQuery<T>(
  profileId: string,
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  try {
    const result = await fetcher();
    await AsyncStorage.setItem(
      cacheKey(profileId, key),
      JSON.stringify({ savedAt: Date.now(), value: result }),
    );
    return result;
  } catch (error) {
    const raw = await AsyncStorage.getItem(cacheKey(profileId, key));
    if (!raw) throw error;
    const parsed = JSON.parse(raw) as { value: T };
    return parsed.value;
  }
}

export async function clearQueryCache(profileId: string): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const prefix = `${PREFIX}:${profileId}:`;
  const matching = keys.filter((key) => key.startsWith(prefix));
  if (matching.length > 0) await AsyncStorage.multiRemove(matching);
}

import { Image } from "expo-image";

const BATCH_SIZE = 8;

/**
 * Proactively stores artwork in expo-image's disk cache while connectivity is
 * available. Individual failures are ignored so one missing image cannot abort
 * the rest of the library warm-up.
 */
export async function warmArtworkCache(
  values: Array<string | null | undefined>,
): Promise<void> {
  const urls = [...new Set(values.filter((value): value is string => Boolean(value)))];
  for (let index = 0; index < urls.length; index += BATCH_SIZE) {
    const batch = urls.slice(index, index + BATCH_SIZE);
    await Promise.allSettled(
      batch.map((url) => Image.prefetch(url, "disk")),
    );
  }
}

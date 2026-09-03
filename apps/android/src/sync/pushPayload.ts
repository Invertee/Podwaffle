export type PushData = Record<string, unknown>;

function parseDataString(value: unknown): PushData | null {
  if (typeof value !== "string") return null;
  try {
    return asPushData(JSON.parse(value));
  } catch {
    return null;
  }
}

export function asPushData(value: unknown): PushData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const outer = value as PushData;

  // expo-notifications background tasks wrap the FCM data payload as
  // { data: { dataString: "{...}" }, notification: null }. Foreground
  // listeners receive the data object directly, so support both shapes.
  const directDataString = parseDataString(outer.dataString);
  if (directDataString) return directDataString;

  const nested = outer.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const nestedData = nested as PushData;
    const nestedDataString = parseDataString(nestedData.dataString);
    if (nestedDataString) return nestedDataString;
    return nestedData;
  }
  return outer;
}

export function isVisibleLocalNotification(value: unknown): boolean {
  return asPushData(value)?.kind === "podwaffle-local-notification";
}

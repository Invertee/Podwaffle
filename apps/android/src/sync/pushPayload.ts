export type PushData = Record<string, unknown>;

export function asPushData(value: unknown): PushData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const outer = value as PushData;
  const nested = outer.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as PushData;
  }
  return outer;
}

export function isVisibleLocalNotification(value: unknown): boolean {
  return asPushData(value)?.kind === "podwaffle-local-notification";
}

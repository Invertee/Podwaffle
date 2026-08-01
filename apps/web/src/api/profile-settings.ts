import type { PlaybackSettings } from "@podwaffle/contracts";

export async function updateProfilePlaybackSettings(
  playback: PlaybackSettings,
  expectedRevision: number,
): Promise<{ settings: Record<string, unknown>; revision: number }> {
  const response = await fetch("/api/v1/profile/settings", {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      commandId: crypto.randomUUID(),
      expectedRevision,
      playback,
    }),
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as {
        error?: { message?: string };
      };
      message = body.error?.message ?? message;
    } catch {
      // Use the status fallback when the server did not return JSON.
    }
    throw new Error(message);
  }
  return (await response.json()) as {
    settings: Record<string, unknown>;
    revision: number;
  };
}

import type { PlaybackSettings } from "@podwaffle/contracts";

import { ApiClientError, createCommandId } from "./client";

export async function updateProfilePlaybackSettings(
  serverUrl: string,
  token: string,
  playback: PlaybackSettings,
  expectedRevision: number,
): Promise<{ settings: Record<string, unknown>; revision: number }> {
  const response = await fetch(`${serverUrl}/api/v1/profile/settings`, {
    method: "PATCH",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      commandId: createCommandId(),
      expectedRevision,
      playback,
    }),
  });
  if (!response.ok) {
    let body: ConstructorParameters<typeof ApiClientError>[1];
    try {
      body = (await response.json()) as ConstructorParameters<
        typeof ApiClientError
      >[1];
    } catch {
      body = undefined;
    }
    throw new ApiClientError(response.status, body);
  }
  return (await response.json()) as {
    settings: Record<string, unknown>;
    revision: number;
  };
}

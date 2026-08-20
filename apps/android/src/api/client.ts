import type {
  ApiErrorBody,
  CastConfirmedState,
  Device,
  DiscoveryResult,
  Episode,
  ListeningStats,
  PlaybackCommand,
  PlaybackState,
  Podcast,
  PublicProfile,
  QueueItem,
  Session,
  Snapshot,
  Subscription,
  SyncEvent,
  SystemInfo,
} from "@podwaffle/contracts";

const REQUEST_TIMEOUT_MS = 20_000;
const FEED_REQUEST_TIMEOUT_MS = 45_000;

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly body?: ApiErrorBody,
  ) {
    super(body?.error.message ?? `Request failed (${status})`);
    this.name = "ApiClientError";
  }
}

export function normalizeServerUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Enter your Podwaffle server URL.");
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const parsed = new URL(withProtocol);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("The server URL must use HTTP or HTTPS.");
  }
  return parsed.toString().replace(/\/+$/, "");
}

export function createCommandId(): string {
  const runtime = globalThis as typeof globalThis & {
    crypto?: { randomUUID?: () => string };
  };
  if (typeof runtime.crypto?.randomUUID === "function") {
    return runtime.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

async function request<T>(
  serverUrl: string,
  path: string,
  token?: string,
  init?: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${serverUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
    if (!response.ok) {
      let body: ApiErrorBody | undefined;
      try {
        body = (await response.json()) as ApiErrorBody;
      } catch {
        body = undefined;
      }
      throw new ApiClientError(response.status, body);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("The server did not respond in time.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function commandBody(revision: number, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    commandId: createCommandId(),
    expectedRevision: revision,
    ...extra,
  });
}

export const api = {
  system: (serverUrl: string) =>
    request<SystemInfo>(serverUrl, "/version.json"),

  profiles: (serverUrl: string) =>
    request<{ profiles: PublicProfile[] }>(
      serverUrl,
      "/api/v1/join/profiles",
    ).then((result) => result.profiles),

  join: (
    serverUrl: string,
    body: {
      profileId: string;
      joinCode: string;
      deviceName: string;
      platform: "android";
      appVersion?: string;
      runtimeVersion?: string;
    },
  ) =>
    request<{ session: Session; token: string }>(
      serverUrl,
      "/api/v1/join",
      undefined,
      { method: "POST", body: JSON.stringify(body) },
    ),

  me: (serverUrl: string, token: string) =>
    request<{ session: Session }>(serverUrl, "/api/v1/me", token).then(
      (result) => result?.session,
    ),

  snapshot: (serverUrl: string, token: string) =>
    request<Snapshot>(serverUrl, "/api/v1/snapshot", token),

  sync: (serverUrl: string, token: string, afterRevision: number) =>
    request<{
      events: SyncEvent[];
      currentRevision: number;
      snapshotRequired?: boolean;
    }>(serverUrl, `/api/v1/sync?afterRevision=${afterRevision}`, token),

  subscriptions: (serverUrl: string, token: string) =>
    request<{ subscriptions: Subscription[] }>(
      serverUrl,
      "/api/v1/subscriptions",
      token,
    ).then((result) => result.subscriptions),

  search: (serverUrl: string, token: string, query: string) =>
    request<{ results: DiscoveryResult[] }>(
      serverUrl,
      `/api/v1/discover/search?q=${encodeURIComponent(query)}`,
      token,
    ).then((result) => result.results),

  subscribe: (
    serverUrl: string,
    token: string,
    item: DiscoveryResult,
    revision: number,
  ) =>
    request<{ subscription: Subscription; revision: number }>(
      serverUrl,
      "/api/v1/subscriptions",
      token,
      {
        method: "POST",
        body: commandBody(revision, {
          feedUrl: item.feedUrl,
          appleCollectionId: item.appleCollectionId,
          title: item.title,
          ...(item.author ? { author: item.author } : {}),
          ...(item.artworkUrl ? { artworkUrl: item.artworkUrl } : {}),
        }),
      },
      FEED_REQUEST_TIMEOUT_MS,
    ),

  unsubscribe: (
    serverUrl: string,
    token: string,
    podcastId: string,
    revision: number,
  ) =>
    request<{ podcastId: string; revision: number }>(
      serverUrl,
      `/api/v1/subscriptions/${podcastId}`,
      token,
      { method: "DELETE", body: commandBody(revision) },
    ),

  reorderSubscriptions: (
    serverUrl: string,
    token: string,
    podcastIds: string[],
    revision: number,
  ) =>
    request<{ subscriptions: Subscription[]; revision: number }>(
      serverUrl,
      "/api/v1/subscriptions/order",
      token,
      {
        method: "PUT",
        body: commandBody(revision, { podcastIds }),
      },
    ),

  podcast: (serverUrl: string, token: string, podcastId: string) =>
    request<{ podcast: Podcast }>(
      serverUrl,
      `/api/v1/podcasts/${podcastId}`,
      token,
    ).then((result) => result.podcast),

  episodes: (serverUrl: string, token: string, podcastId: string) =>
    request<{ episodes: Episode[] }>(
      serverUrl,
      `/api/v1/podcasts/${podcastId}/episodes`,
      token,
    ).then((result) => result.episodes),

  inProgress: (serverUrl: string, token: string) =>
    request<{ episodes: Episode[] }>(
      serverUrl,
      "/api/v1/episodes/in-progress",
      token,
    ).then((result) => result.episodes),

  history: (serverUrl: string, token: string) =>
    request<{ episodes: Episode[] }>(serverUrl, "/api/v1/history", token).then(
      (result) => result.episodes,
    ),

  episode: (serverUrl: string, token: string, episodeId: string) =>
    request<{ episode: Episode }>(
      serverUrl,
      `/api/v1/episodes/${episodeId}`,
      token,
    ).then((result) => result.episode),

  setPlayed: (
    serverUrl: string,
    token: string,
    episodeId: string,
    played: boolean,
    revision: number,
  ) =>
    request<{ episode: Episode; revision: number }>(
      serverUrl,
      `/api/v1/episodes/${episodeId}/state`,
      token,
      {
        method: "PATCH",
        body: commandBody(revision, { played }),
      },
    ),

  completeEpisode: (
    serverUrl: string,
    token: string,
    episodeId: string,
    positionMs: number,
    durationMs: number | null,
  ) =>
    request<{
      episode: Episode;
      queue: QueueItem[];
      revision: number;
      replayed: boolean;
    }>(serverUrl, `/api/v1/episodes/${episodeId}/progress`, token, {
      method: "POST",
      body: JSON.stringify({
        commandId: createCommandId(),
        positionMs,
        durationMs,
        completed: true,
      }),
    }),

  queue: (serverUrl: string, token: string) =>
    request<{ queue: QueueItem[] }>(serverUrl, "/api/v1/queue", token).then(
      (result) => result.queue,
    ),

  addQueue: (
    serverUrl: string,
    token: string,
    episodeId: string,
    position: "next" | "bottom",
    revision: number,
  ) =>
    request<{ queue: QueueItem[]; revision: number }>(
      serverUrl,
      "/api/v1/queue/items",
      token,
      {
        method: "POST",
        body: commandBody(revision, { episodeId, position }),
      },
    ),

  removeQueue: (
    serverUrl: string,
    token: string,
    queueItemId: string,
    revision: number,
  ) =>
    request<{ queue: QueueItem[]; revision: number }>(
      serverUrl,
      `/api/v1/queue/items/${queueItemId}`,
      token,
      { method: "DELETE", body: commandBody(revision) },
    ),

  reorderQueue: (
    serverUrl: string,
    token: string,
    queueItemIds: string[],
    revision: number,
  ) =>
    request<{ queue: QueueItem[]; revision: number }>(
      serverUrl,
      "/api/v1/queue/order",
      token,
      {
        method: "PUT",
        body: commandBody(revision, { queueItemIds }),
      },
    ),

  clearQueue: (serverUrl: string, token: string, revision: number) =>
    request<{ queue: QueueItem[]; revision: number }>(
      serverUrl,
      "/api/v1/queue",
      token,
      { method: "DELETE", body: commandBody(revision) },
    ),

  devices: (serverUrl: string, token: string) =>
    request<{ devices: Device[] }>(serverUrl, "/api/v1/devices", token).then(
      (result) => result.devices,
    ),

  revoke: (
    serverUrl: string,
    token: string,
    deviceId: string,
    revision: number,
  ) =>
    request<{ revision: number }>(
      serverUrl,
      `/api/v1/devices/${deviceId}`,
      token,
      { method: "DELETE", body: commandBody(revision) },
    ),

  playback: (serverUrl: string, token: string) =>
    request<{ playback: PlaybackState }>(
      serverUrl,
      "/api/v1/playback",
      token,
    ).then((result) => result.playback),

  acquirePlayback: (
    serverUrl: string,
    token: string,
    body: {
      episodeId?: string;
      positionMs: number;
      durationMs?: number | null;
      playbackRate: number;
      takeover?: boolean;
    },
  ) =>
    request<{ playback: PlaybackState; revision: number }>(
      serverUrl,
      "/api/v1/playback/lease",
      token,
      { method: "POST", body: JSON.stringify(body) },
    ).then((result) => result.playback),

  releasePlayback: (serverUrl: string, token: string) =>
    request<{ playback: PlaybackState; revision: number }>(
      serverUrl,
      "/api/v1/playback/lease",
      token,
      { method: "DELETE" },
    ).then((result) => result.playback),

  updatePlayback: (
    serverUrl: string,
    token: string,
    body: {
      episodeId: string;
      positionMs: number;
      durationMs?: number | null;
      state: "playing" | "paused" | "stopped";
      playbackRate: number;
    },
  ) =>
    request<{
      playback: PlaybackState;
      episode: Episode;
      revision: number;
    }>(serverUrl, "/api/v1/playback/state", token, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  startCast: (
    serverUrl: string,
    token: string,
    confirmed: CastConfirmedState,
    takeover = false,
  ) =>
    request<{ playback: PlaybackState; revision: number }>(
      serverUrl,
      "/api/v1/playback/cast",
      token,
      {
        method: "POST",
        body: JSON.stringify({
          commandId: createCommandId(),
          confirmed,
          takeover,
        }),
      },
    ),

  stopCast: (
    serverUrl: string,
    token: string,
    body: {
      positionMs: number;
      durationMs: number | null;
      state: "playing" | "paused" | "stopped";
      playbackRate: number;
    },
  ) =>
    request<{ playback: PlaybackState; revision: number }>(
      serverUrl,
      "/api/v1/playback/cast",
      token,
      {
        method: "DELETE",
        body: JSON.stringify({ commandId: createCommandId(), ...body }),
      },
    ),

  playbackCommand: (
    serverUrl: string,
    token: string,
    command: PlaybackCommand,
  ) =>
    request<{
      commandId: string;
      status: "pending" | "accepted" | "rejected" | "cancelled";
      delivered: boolean;
      replayed: boolean;
    }>(serverUrl, "/api/v1/playback/commands", token, {
      method: "POST",
      body: JSON.stringify(command),
    }),

  playbackCommandResult: (
    serverUrl: string,
    token: string,
    result: {
      commandId: string;
      status: "accepted" | "rejected";
      confirmed?: CastConfirmedState;
      message?: string;
    },
  ) =>
    request<{
      playback: PlaybackState;
      replayed: boolean;
    }>(
      serverUrl,
      `/api/v1/playback/commands/${result.commandId}/result`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          status: result.status,
          ...(result.confirmed ? { confirmed: result.confirmed } : {}),
          ...(result.message ? { message: result.message } : {}),
        }),
      },
    ),

  movement: (
    serverUrl: string,
    token: string,
    body: {
      commandId: string;
      episodeId: string;
      type: "skip-forward" | "skip-backward" | "seek";
      fromPositionMs: number;
      requestedPositionMs: number;
      confirmedPositionMs: number;
    },
  ) =>
    request<{ recorded: boolean }>(
      serverUrl,
      "/api/v1/playback/movements",
      token,
      { method: "POST", body: JSON.stringify(body) },
    ),

  telemetry: (
    serverUrl: string,
    token: string,
    body: {
      playbackInstanceId: string;
      sequence: number;
      episodeId: string;
      source: "android-local" | "cast";
      listenedMs: number;
      contentConsumedMs: number;
    },
  ) =>
    request<{ recorded: boolean }>(
      serverUrl,
      "/api/v1/playback/telemetry",
      token,
      { method: "POST", body: JSON.stringify(body) },
    ),

  stats: (
    serverUrl: string,
    token: string,
    period: "today" | "7d" | "30d" | "year" | "all",
  ) =>
    request<{ stats: ListeningStats }>(
      serverUrl,
      `/api/v1/stats?period=${period}`,
      token,
    ).then((result) => result.stats),
};

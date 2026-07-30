import type {
  ApiErrorBody,
  CastConfirmedState,
  Device,
  DiscoveryResult,
  Episode,
  ListeningStats,
  PlaybackCommand,
  PlaybackState,
  PublicProfile,
  QueueItem,
  Session,
  Snapshot,
  Subscription,
  SyncEvent,
} from "@podwaffle/contracts";

export class ApiClientError extends Error {
  public constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody | undefined,
  ) {
    super(body?.error.message ?? `Request failed (${status})`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
    credentials: "same-origin",
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
}

export const api = {
  profiles: () =>
    request<{ profiles: PublicProfile[] }>("/join/profiles").then(
      (result) => result.profiles,
    ),
  me: () =>
    request<{ session: Session }>("/me").then((result) => result.session),
  join: (body: {
    profileId: string;
    joinCode: string;
    deviceName: string;
    platform: "web";
  }) =>
    request<{ session: Session }>("/join", {
      method: "POST",
      body: JSON.stringify(body),
    }).then((result) => result.session),
  logout: () => request<void>("/logout", { method: "POST" }),
  snapshot: () => request<Snapshot>("/snapshot"),
  devices: () =>
    request<{ devices: Device[] }>("/devices").then((result) => result.devices),
  revoke: (deviceId: string, revision: number) =>
    request<{ revision: number }>(`/devices/${deviceId}`, {
      method: "DELETE",
      body: JSON.stringify({
        commandId: crypto.randomUUID(),
        expectedRevision: revision,
      }),
    }),
  sync: (afterRevision: number) =>
    request<{
      events: SyncEvent[];
      currentRevision: number;
      snapshotRequired?: boolean;
    }>(`/sync?afterRevision=${afterRevision}`),
  subscriptions: () =>
    request<{ subscriptions: Subscription[] }>("/subscriptions").then(
      (result) => result.subscriptions,
    ),
  search: (query: string) =>
    request<{ results: DiscoveryResult[] }>(
      `/discover/search?q=${encodeURIComponent(query)}`,
    ).then((result) => result.results),
  subscribe: (item: DiscoveryResult, revision: number) =>
    request<{ subscription: Subscription; revision: number }>(
      "/subscriptions",
      {
        method: "POST",
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedRevision: revision,
          feedUrl: item.feedUrl,
          appleCollectionId: item.appleCollectionId,
          title: item.title,
          ...(item.author ? { author: item.author } : {}),
          ...(item.artworkUrl ? { artworkUrl: item.artworkUrl } : {}),
        }),
      },
    ),
  unsubscribe: (podcastId: string, revision: number) =>
    request<{ revision: number }>(`/subscriptions/${podcastId}`, {
      method: "DELETE",
      body: JSON.stringify({
        commandId: crypto.randomUUID(),
        expectedRevision: revision,
      }),
    }),
  reorderSubscriptions: (podcastIds: string[], revision: number) =>
    request<{ subscriptions: Subscription[]; revision: number }>(
      "/subscriptions/order",
      {
        method: "PUT",
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedRevision: revision,
          podcastIds,
        }),
      },
    ),
  episodes: (podcastId: string) =>
    request<{ episodes: Episode[] }>(`/podcasts/${podcastId}/episodes`).then(
      (result) => result.episodes,
    ),
  inProgress: () =>
    request<{ episodes: Episode[] }>("/episodes/in-progress").then(
      (result) => result.episodes,
    ),
  history: () =>
    request<{ episodes: Episode[] }>("/history").then(
      (result) => result.episodes,
    ),
  setPlayed: (episodeId: string, played: boolean, revision: number) =>
    request<{ episode: Episode; revision: number }>(
      `/episodes/${episodeId}/state`,
      {
        method: "PATCH",
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedRevision: revision,
          played,
        }),
      },
    ),
  completeEpisode: (
    episodeId: string,
    positionMs: number,
    durationMs: number | null,
  ) =>
    request<{
      episode: Episode;
      queue: QueueItem[];
      revision: number;
      replayed: boolean;
    }>(`/episodes/${episodeId}/progress`, {
      method: "POST",
      body: JSON.stringify({
        commandId: crypto.randomUUID(),
        positionMs,
        durationMs,
      }),
    }),
  queue: () =>
    request<{ queue: QueueItem[] }>("/queue").then((result) => result.queue),
  addQueue: (
    episodeId: string,
    position: "next" | "bottom",
    revision: number,
  ) =>
    request<{ queue: QueueItem[]; revision: number }>("/queue/items", {
      method: "POST",
      body: JSON.stringify({
        commandId: crypto.randomUUID(),
        expectedRevision: revision,
        episodeId,
        position,
      }),
    }),
  removeQueue: (queueItemId: string, revision: number) =>
    request<{ queue: QueueItem[]; revision: number }>(
      `/queue/items/${queueItemId}`,
      {
        method: "DELETE",
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedRevision: revision,
        }),
      },
    ),
  reorderQueue: (queueItemIds: string[], revision: number) =>
    request<{ queue: QueueItem[]; revision: number }>("/queue/order", {
      method: "PUT",
      body: JSON.stringify({
        commandId: crypto.randomUUID(),
        expectedRevision: revision,
        queueItemIds,
      }),
    }),
  clearQueue: (revision: number) =>
    request<{ queue: QueueItem[]; revision: number }>("/queue", {
      method: "DELETE",
      body: JSON.stringify({
        commandId: crypto.randomUUID(),
        expectedRevision: revision,
      }),
    }),
  playback: () =>
    request<{ playback: PlaybackState }>("/playback").then(
      (result) => result.playback,
    ),
  acquirePlayback: (body: {
    episodeId?: string;
    positionMs: number;
    durationMs?: number | null;
    playbackRate: number;
  }) =>
    request<{ playback: PlaybackState }>("/playback/lease", {
      method: "POST",
      body: JSON.stringify(body),
    }).then((result) => result.playback),
  releasePlayback: () =>
    request<{ playback: PlaybackState }>("/playback/lease", {
      method: "DELETE",
    }),
  updatePlayback: (body: {
    episodeId: string;
    positionMs: number;
    durationMs?: number | null;
    state: "playing" | "paused" | "stopped";
    playbackRate: number;
  }) =>
    request<{ playback: PlaybackState }>("/playback/state", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  startCast: (confirmed: CastConfirmedState) =>
    request<{ playback: PlaybackState; revision: number }>("/playback/cast", {
      method: "POST",
      body: JSON.stringify({
        commandId: crypto.randomUUID(),
        confirmed,
      }),
    }),
  stopCast: (body: {
    positionMs: number;
    durationMs: number | null;
    state: "playing" | "paused" | "stopped";
    playbackRate: number;
  }) =>
    request<{ playback: PlaybackState; revision: number }>("/playback/cast", {
      method: "DELETE",
      body: JSON.stringify({
        commandId: crypto.randomUUID(),
        ...body,
      }),
    }),
  playbackCommand: (body: PlaybackCommand) =>
    request<{
      commandId: string;
      status: "pending" | "accepted" | "rejected" | "cancelled";
      delivered: boolean;
      replayed: boolean;
    }>("/playback/commands", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  movement: (body: {
    commandId: string;
    episodeId: string;
    type: "skip-forward" | "skip-backward" | "seek";
    fromPositionMs: number;
    requestedPositionMs: number;
    confirmedPositionMs: number;
  }) =>
    request<{ recorded: boolean }>("/playback/movements", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  telemetry: (body: {
    playbackInstanceId: string;
    sequence: number;
    episodeId: string;
    source: "web-local" | "cast";
    listenedMs: number;
    contentConsumedMs: number;
  }) =>
    request<{ recorded: boolean }>("/playback/telemetry", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  stats: (period: "today" | "7d" | "30d" | "year" | "all") =>
    request<{ stats: ListeningStats }>(`/stats?period=${period}`).then(
      (result) => result.stats,
    ),
};

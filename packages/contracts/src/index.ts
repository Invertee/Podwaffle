import { z } from "zod";

export const platformSchema = z.enum(["web", "android"]);

export const joinRequestSchema = z.object({
  profileId: z.uuid(),
  joinCode: z.string().min(1).max(256),
  deviceName: z.string().trim().min(1).max(100),
  platform: platformSchema,
  appVersion: z.string().max(50).optional(),
  runtimeVersion: z.string().max(50).optional(),
  commandId: z.uuid().optional(),
});

export const commandSchema = z.object({
  commandId: z.uuid(),
  expectedRevision: z.number().int().nonnegative().optional(),
});

export const playbackSettingsSchema = z.object({
  skipBackwardSeconds: z.number().int().min(1).max(120),
  skipForwardSeconds: z.number().int().min(1).max(120),
});

export const profileSettingsUpdateSchema = commandSchema.extend({
  playback: playbackSettingsSchema,
});

export const revokeDeviceSchema = commandSchema;

export const subscribeSchema = commandSchema.extend({
  feedUrl: z.url(),
  appleCollectionId: z.string().max(100).optional(),
  title: z.string().trim().min(1).max(500).optional(),
  author: z.string().trim().max(500).optional(),
  artworkUrl: z.url().optional(),
});

export const subscriptionOrderSchema = commandSchema.extend({
  podcastIds: z.array(z.uuid()).max(10_000),
});

export const episodeStateSchema = commandSchema.extend({
  played: z.boolean(),
});

export const episodeProgressSchema = commandSchema.extend({
  positionMs: z.number().int().nonnegative(),
  durationMs: z.number().int().positive().nullable().optional(),
});

export const queueItemSchema = commandSchema.extend({
  episodeId: z.uuid(),
  position: z.enum(["next", "bottom"]).default("bottom"),
});

export const queueOrderSchema = commandSchema.extend({
  queueItemIds: z.array(z.uuid()).max(10_000),
});

export const playbackLeaseSchema = z.object({
  episodeId: z.uuid().optional(),
  positionMs: z.number().int().nonnegative().default(0),
  durationMs: z.number().int().positive().nullable().optional(),
  playbackRate: z.number().min(0.5).max(4).default(1),
});

export const playbackStateSchema = z.object({
  episodeId: z.uuid(),
  positionMs: z.number().int().nonnegative(),
  durationMs: z.number().int().positive().nullable().optional(),
  state: z.enum(["playing", "paused", "stopped"]),
  playbackRate: z.number().min(0.5).max(4),
});

export const playbackCommandActionSchema = z.enum([
  "play",
  "pause",
  "seek",
  "skip-forward",
  "skip-backward",
  "next",
  "previous",
  "play-episode",
]);

export const playbackCommandSchema = z.object({
  commandId: z.uuid(),
  action: playbackCommandActionSchema,
  positionMs: z.number().int().nonnegative().optional(),
  offsetMs: z.number().int().positive().optional(),
  episodeId: z.uuid().optional(),
  targetDeviceId: z.uuid().optional(),
  playbackState: z.enum(["playing", "paused"]).optional(),
});

export const castConfirmedStateSchema = z.object({
  episodeId: z.uuid(),
  positionMs: z.number().int().nonnegative(),
  durationMs: z.number().int().positive().nullable(),
  state: z.enum(["playing", "paused", "stopped"]),
  playbackRate: z.number().min(0.5).max(4),
  castSessionId: z.string().trim().min(1).max(500),
  volume: z.number().min(0).max(1).optional(),
  muted: z.boolean().optional(),
});

export const castStartSchema = commandSchema.extend({
  confirmed: castConfirmedStateSchema,
});

export const castStopSchema = commandSchema.extend({
  positionMs: z.number().int().nonnegative(),
  durationMs: z.number().int().positive().nullable(),
  state: z.enum(["playing", "paused", "stopped"]),
  playbackRate: z.number().min(0.5).max(4),
});

export const movementEventSchema = z.object({
  commandId: z.uuid(),
  episodeId: z.uuid(),
  type: z.enum(["skip-forward", "skip-backward", "seek"]),
  fromPositionMs: z.number().int().nonnegative(),
  requestedPositionMs: z.number().int().nonnegative(),
  confirmedPositionMs: z.number().int().nonnegative(),
});

export const playbackTelemetrySchema = z.object({
  playbackInstanceId: z.uuid(),
  sequence: z.number().int().nonnegative(),
  episodeId: z.uuid(),
  source: z.enum(["web-local", "android-local", "cast"]),
  listenedMs: z.number().int().nonnegative().max(300_000),
  contentConsumedMs: z.number().int().nonnegative().max(1_200_000),
  recordedAt: z.iso.datetime().optional(),
});

export const statsPeriodSchema = z.enum(["today", "7d", "30d", "year", "all"]);

export const syncEventTypeSchema = z.enum([
  "profile.settings.updated",
  "device.joined",
  "device.revoked",
  "device.push.updated",
  "subscription.added",
  "subscription.removed",
  "subscription.order.updated",
  "subscription.download-settings.updated",
  "podcast.metadata.updated",
  "podcast.new-indicator.updated",
  "episode.discovered",
  "episode.metadata.updated",
  "episode.progress.updated",
  "episode.played-state.updated",
  "queue.updated",
  "playback.state.updated",
  "playback.owner.updated",
  "playback.cast.updated",
  "stats.updated",
  "history.updated",
]);

export const syncEventSchema = z.object({
  revision: z.number().int().positive(),
  type: syncEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sync.event"), event: syncEventSchema }),
  z.object({
    type: z.literal("playback.command"),
    command: playbackCommandSchema.extend({
      requestedByDeviceId: z.uuid(),
    }),
  }),
  z.object({
    type: z.literal("playback.command.cancelled"),
    commandId: z.uuid().optional(),
    reason: z.string(),
  }),
  z.object({
    type: z.literal("server.notice"),
    code: z.string(),
    message: z.string(),
  }),
]);

export const playbackCommandResultSchema = z.object({
  commandId: z.uuid(),
  status: z.enum(["accepted", "rejected"]),
  confirmed: castConfirmedStateSchema.optional(),
  message: z.string().max(500).optional(),
});

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("client.heartbeat") }),
  z.object({
    type: z.literal("sync.ack"),
    revision: z.number().int().nonnegative(),
  }),
  playbackCommandResultSchema.extend({
    type: z.literal("playback.command.result"),
  }),
  z.object({
    type: z.literal("playback.telemetry"),
    payload: z.record(z.string(), z.unknown()),
  }),
]);

export type Platform = z.infer<typeof platformSchema>;
export type JoinRequest = z.infer<typeof joinRequestSchema>;
export type SyncEvent = z.infer<typeof syncEventSchema>;
export type SyncEventType = z.infer<typeof syncEventTypeSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type PlaybackCommand = z.infer<typeof playbackCommandSchema>;
export type PlaybackCommandAction = z.infer<typeof playbackCommandActionSchema>;
export type CastConfirmedState = z.infer<typeof castConfirmedStateSchema>;
export type PlaybackSettings = z.infer<typeof playbackSettingsSchema>;

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    currentRevision?: number;
  };
}

export interface PublicProfile {
  id: string;
  displayName: string;
}

export interface Device {
  id: string;
  name: string;
  platform: Platform;
  appVersion: string | null;
  runtimeVersion: string | null;
  lastSeenAt: string;
  createdAt: string;
  current: boolean;
}

export interface Session {
  profile: PublicProfile & { revision: number; timezone: string };
  device: Device;
}

export interface ProfileSettings extends Record<string, unknown> {
  playback?: PlaybackSettings;
}

export interface Snapshot {
  revision: number;
  profile: PublicProfile & {
    timezone: string;
    settings: ProfileSettings;
  };
  devices: Device[];
  subscriptions: Subscription[];
  queue: QueueItem[];
  playback: PlaybackState | null;
}

export interface Podcast {
  id: string;
  feedUrl: string;
  appleCollectionId: string | null;
  title: string;
  author: string | null;
  description: string | null;
  artworkUrl: string | null;
  websiteUrl: string | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
}

export interface Subscription extends Podcast {
  sortIndex: number;
  subscribedAt: string;
  hasNewEpisode: boolean;
}

export interface Episode {
  id: string;
  podcastId: string;
  podcastTitle: string;
  title: string;
  descriptionHtml: string | null;
  enclosureUrl: string | null;
  enclosureType: string | null;
  publishedAt: string | null;
  firstDiscoveredAt: string;
  durationMs: number | null;
  artworkUrl: string | null;
  podcastArtworkUrl?: string | null;
  episodeUrl: string | null;
  positionMs: number;
  played: boolean;
  playedAt: string | null;
  manualPlayState: "none" | "played" | "unplayed";
  lastPlayedAt: string | null;
}

export interface QueueItem {
  id: string;
  sortIndex: number;
  addedAt: string;
  episode: Episode;
}

export interface DiscoveryResult {
  appleCollectionId: string;
  feedUrl: string;
  title: string;
  author: string | null;
  artworkUrl: string | null;
  genre: string | null;
  subscribed: boolean;
}

export interface SystemInfo {
  name: "Podwaffle";
  version: string;
  apiVersion: "v1";
  schemaVersion: number;
  ready: boolean;
}

export interface PlaybackState {
  episode: Episode | null;
  positionMs: number;
  durationMs: number | null;
  state: "playing" | "paused" | "stopped";
  mode: "local" | "cast";
  playbackRate: number;
  activeDeviceId: string | null;
  leaseExpiresAt: string | null;
  castOwnerDeviceId: string | null;
  castSessionId: string | null;
  ownedByCurrentDevice: boolean;
}

export interface ListeningStats {
  period: z.infer<typeof statsPeriodSchema>;
  fromDate: string | null;
  toDate: string;
  listenedMs: number;
  contentConsumedMs: number;
  skippedForwardMs: number;
  rewoundMs: number;
  episodesCompleted: number;
  activeListeningDays: number;
  subscriptions: number;
  currentStreak: number;
  longestStreak: number;
  historyEntries: number;
}

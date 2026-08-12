import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import type {
  PublicProfile,
  QueueItem,
  Session,
  Snapshot,
} from "@podwaffle/contracts";

import { ApiClientError, api, normalizeServerUrl } from "../api/client";
import { clearQueryCache } from "../api/queryCache";
import { PodwaffleMediaModule } from "../native-media";
import {
  clearPendingPlayback,
  pendingPlaybackUpdates,
} from "../playback/offlineProgress";
import {
  snapshotWithoutCompletedEpisodes,
  snapshotWithoutPendingCompletions,
} from "../playback/queueReconciliation";
import { useDownloadsStore } from "./downloads";

const CREDENTIALS_KEY = "podwaffle.credentials.v1";
const SNAPSHOT_KEY = "podwaffle.snapshot.v1";
const PLAYBACK_SETTINGS_KEY_PREFIX = "podwaffle.playback-settings.v1";
const DEFAULT_SKIP_BACKWARD_SECONDS = 15;
const DEFAULT_SKIP_FORWARD_SECONDS = 30;

export interface Credentials {
  serverUrl: string;
  token: string;
}

interface PlaybackSettings {
  skipBackwardSeconds: number;
  skipForwardSeconds: number;
}

type AuthStatus = "restoring" | "signed-out" | "authenticated";
type ConnectionStatus = "checking" | "online" | "offline";

interface AuthStore {
  status: AuthStatus;
  connection: ConnectionStatus;
  credentials: Credentials | null;
  session: Session | null;
  snapshot: Snapshot | null;
  lastSyncAt: string | null;
  error: string | null;
  liveSyncConnected: boolean;
  skipBackwardSeconds: number;
  skipForwardSeconds: number;
  settingsProfileId: string | null;
  restore: () => Promise<void>;
  validateServer: (value: string) => Promise<{
    serverUrl: string;
    profiles: PublicProfile[];
  }>;
  join: (input: {
    serverUrl: string;
    profileId: string;
    joinCode: string;
    deviceName: string;
  }) => Promise<void>;
  refresh: () => Promise<void>;
  applyQueueMutation: (queue: QueueItem[], revision: number) => Promise<void>;
  removeQueueEpisodesLocally: (episodeIds: string[]) => Promise<void>;
  setSkipDurations: (
    backwardSeconds: number,
    forwardSeconds: number,
  ) => Promise<void>;
  setLiveSyncConnected: (connected: boolean) => void;
  logout: () => Promise<void>;
}

function errorMessage(error: unknown): string {
  if (error instanceof TypeError) {
    return "Could not reach the server. Check the address and your network.";
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

function clampSkipSeconds(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(120, Math.round(value)));
}

function settingsKey(profileId: string): string {
  return `${PLAYBACK_SETTINGS_KEY_PREFIX}:${profileId}`;
}

async function readPlaybackSettings(
  profileId: string,
): Promise<PlaybackSettings> {
  try {
    const raw = await AsyncStorage.getItem(settingsKey(profileId));
    if (!raw) throw new Error("No saved settings");
    const parsed = JSON.parse(raw) as Partial<PlaybackSettings>;
    return {
      skipBackwardSeconds: clampSkipSeconds(
        Number(parsed.skipBackwardSeconds),
        DEFAULT_SKIP_BACKWARD_SECONDS,
      ),
      skipForwardSeconds: clampSkipSeconds(
        Number(parsed.skipForwardSeconds),
        DEFAULT_SKIP_FORWARD_SECONDS,
      ),
    };
  } catch {
    return {
      skipBackwardSeconds: DEFAULT_SKIP_BACKWARD_SECONDS,
      skipForwardSeconds: DEFAULT_SKIP_FORWARD_SECONDS,
    };
  }
}

async function writePlaybackSettings(
  profileId: string,
  settings: PlaybackSettings,
): Promise<void> {
  await AsyncStorage.setItem(settingsKey(profileId), JSON.stringify(settings));
}

async function clearPersistedState(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(CREDENTIALS_KEY),
    AsyncStorage.removeItem(SNAPSHOT_KEY),
    PodwaffleMediaModule.clearConfiguration().catch(() => undefined),
  ]);
}

async function reconcilePendingCompletionSnapshot(
  snapshot: Snapshot | null,
): Promise<Snapshot | null> {
  if (!snapshot) return null;
  const pending = await pendingPlaybackUpdates(snapshot.profile.id);
  return snapshotWithoutPendingCompletions(snapshot, pending, null);
}

async function configureNative(
  credentials: Credentials,
  session: Session,
  settings: PlaybackSettings,
): Promise<void> {
  try {
    await PodwaffleMediaModule.configure({
      serverBaseUrl: credentials.serverUrl,
      deviceId: session.device.id,
      deviceToken: credentials.token,
      profileId: session.profile.id,
      skipBackSeconds: settings.skipBackwardSeconds,
      skipForwardSeconds: settings.skipForwardSeconds,
      downloadRetentionDays: 30,
      maxDownloadStorageBytes: 2_000_000_000,
    });
  } catch {
    // Authentication and browsing remain usable in web/test shells.
  }
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  status: "restoring",
  connection: "checking",
  credentials: null,
  session: null,
  snapshot: null,
  lastSyncAt: null,
  error: null,
  liveSyncConnected: false,
  skipBackwardSeconds: DEFAULT_SKIP_BACKWARD_SECONDS,
  skipForwardSeconds: DEFAULT_SKIP_FORWARD_SECONDS,
  settingsProfileId: null,

  restore: async () => {
    try {
      const [credentialsJson, snapshotJson] = await Promise.all([
        SecureStore.getItemAsync(CREDENTIALS_KEY),
        AsyncStorage.getItem(SNAPSHOT_KEY),
      ]);
      if (!credentialsJson) {
        set({
          status: "signed-out",
          connection: "offline",
          liveSyncConnected: false,
        });
        return;
      }
      const credentials = JSON.parse(credentialsJson) as Credentials;
      const storedSnapshot = snapshotJson
        ? (JSON.parse(snapshotJson) as Snapshot)
        : null;
      const snapshot = await reconcilePendingCompletionSnapshot(storedSnapshot);
      const profileId = snapshot?.profile.id ?? null;
      const settings = profileId
        ? await readPlaybackSettings(profileId)
        : {
            skipBackwardSeconds: DEFAULT_SKIP_BACKWARD_SECONDS,
            skipForwardSeconds: DEFAULT_SKIP_FORWARD_SECONDS,
          };
      set({
        status: "authenticated",
        connection: "checking",
        credentials,
        snapshot,
        settingsProfileId: profileId,
        ...settings,
      });
      await get().refresh();
    } catch (error) {
      set({
        status: "signed-out",
        connection: "offline",
        error: errorMessage(error),
      });
    }
  },

  validateServer: async (value) => {
    const serverUrl = normalizeServerUrl(value);
    const system = await api.system(serverUrl);
    if (system.name !== "Podwaffle" || system.apiVersion !== "v1") {
      throw new Error("This server is not a compatible Podwaffle v1 server.");
    }
    if (!system.ready)
      throw new Error("The server is starting up. Try again shortly.");
    const profiles = await api.profiles(serverUrl);
    return { serverUrl, profiles };
  },

  join: async (input) => {
    const serverUrl = normalizeServerUrl(input.serverUrl);
    set({ connection: "checking", error: null });
    const result = await api.join(serverUrl, {
      profileId: input.profileId,
      joinCode: input.joinCode,
      deviceName: input.deviceName.trim(),
      platform: "android",
      appVersion: Constants.expoConfig?.version,
      runtimeVersion: String(
        Constants.expoConfig?.extra?.nativeRuntimeVersion ?? "",
      ),
    });
    const credentials = { serverUrl, token: result.token };
    const settings = await readPlaybackSettings(result.session.profile.id);
    await SecureStore.setItemAsync(
      CREDENTIALS_KEY,
      JSON.stringify(credentials),
    );
    const snapshot = await reconcilePendingCompletionSnapshot(
      await api.snapshot(serverUrl, result.token),
    );
    await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
    await configureNative(credentials, result.session, settings);
    set({
      status: "authenticated",
      connection: "online",
      credentials,
      session: result.session,
      snapshot,
      lastSyncAt: new Date().toISOString(),
      settingsProfileId: result.session.profile.id,
      ...settings,
      error: null,
    });
  },

  refresh: async () => {
    const { credentials, snapshot } = get();
    if (!credentials) return;
    if (!snapshot) set({ connection: "checking" });
    try {
      const session = await api.me(credentials.serverUrl, credentials.token);
      if (!session) {
        await clearPersistedState();
        set({
          status: "signed-out",
          connection: "offline",
          credentials: null,
          session: null,
          snapshot: null,
          error: "This device was signed out or revoked.",
          liveSyncConnected: false,
        });
        return;
      }

      let nextSnapshot = snapshot;
      if (snapshot) {
        const changes = await api.sync(
          credentials.serverUrl,
          credentials.token,
          snapshot.revision,
        );
        if (
          changes.snapshotRequired ||
          changes.currentRevision !== snapshot.revision
        ) {
          nextSnapshot = await api.snapshot(
            credentials.serverUrl,
            credentials.token,
          );
        }
      } else {
        nextSnapshot = await api.snapshot(
          credentials.serverUrl,
          credentials.token,
        );
      }
      nextSnapshot = await reconcilePendingCompletionSnapshot(nextSnapshot);
      if (nextSnapshot) {
        await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(nextSnapshot));
      }

      const current = get();
      const settings =
        current.settingsProfileId === session.profile.id
          ? {
              skipBackwardSeconds: current.skipBackwardSeconds,
              skipForwardSeconds: current.skipForwardSeconds,
            }
          : await readPlaybackSettings(session.profile.id);
      await configureNative(credentials, session, settings);
      set({
        status: "authenticated",
        connection: "online",
        session,
        snapshot: nextSnapshot,
        lastSyncAt: new Date().toISOString(),
        settingsProfileId: session.profile.id,
        ...settings,
        error: null,
      });
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        await clearPersistedState();
        set({
          status: "signed-out",
          connection: "offline",
          credentials: null,
          session: null,
          snapshot: null,
          error: "This device was revoked. Join the server again.",
          liveSyncConnected: false,
        });
        return;
      }
      set({ connection: "offline", error: errorMessage(error) });
    }
  },

  applyQueueMutation: async (queue, revision) => {
    const initial = get().snapshot;
    if (!initial || revision < initial.revision) return;
    const pending = await pendingPlaybackUpdates(initial.profile.id);
    const current = get().snapshot;
    if (
      !current ||
      current.profile.id !== initial.profile.id ||
      revision < current.revision
    ) {
      return;
    }
    const nextSnapshot = snapshotWithoutPendingCompletions(
      { ...current, revision, queue },
      pending,
      null,
    );
    set({ snapshot: nextSnapshot, lastSyncAt: new Date().toISOString() });
    const latest = get().snapshot;
    if (latest?.profile.id === nextSnapshot.profile.id) {
      await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(latest));
    }
  },

  removeQueueEpisodesLocally: async (episodeIds) => {
    const snapshot = get().snapshot;
    if (!snapshot || episodeIds.length === 0) return;
    const nextSnapshot = snapshotWithoutCompletedEpisodes(snapshot, episodeIds);
    if (nextSnapshot === snapshot) return;
    set({ snapshot: nextSnapshot });
    const current = get().snapshot;
    if (current?.profile.id === nextSnapshot.profile.id) {
      await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(current));
    }
  },

  setLiveSyncConnected: (liveSyncConnected) => set({ liveSyncConnected }),

  setSkipDurations: async (backwardSeconds, forwardSeconds) => {
    const backward = clampSkipSeconds(
      backwardSeconds,
      DEFAULT_SKIP_BACKWARD_SECONDS,
    );
    const forward = clampSkipSeconds(
      forwardSeconds,
      DEFAULT_SKIP_FORWARD_SECONDS,
    );
    const settings = {
      skipBackwardSeconds: backward,
      skipForwardSeconds: forward,
    };
    const { credentials, session, snapshot } = get();
    const profileId = session?.profile.id ?? snapshot?.profile.id ?? null;
    set(settings);
    if (profileId) await writePlaybackSettings(profileId, settings);
    if (credentials && session) {
      await configureNative(credentials, session, settings);
    }
  },

  logout: async () => {
    const profileId = get().session?.profile.id ?? get().snapshot?.profile.id;
    await clearPersistedState();
    if (profileId) {
      await clearQueryCache(profileId).catch(() => undefined);
      await clearPendingPlayback(profileId).catch(() => undefined);
    }
    useDownloadsStore.getState().clear();
    set({
      status: "signed-out",
      connection: "offline",
      credentials: null,
      session: null,
      snapshot: null,
      lastSyncAt: null,
      settingsProfileId: null,
      skipBackwardSeconds: DEFAULT_SKIP_BACKWARD_SECONDS,
      skipForwardSeconds: DEFAULT_SKIP_FORWARD_SECONDS,
      error: null,
      liveSyncConnected: false,
    });
  },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import type { PublicProfile, Session, Snapshot } from "@podwaffle/contracts";

import { ApiClientError, api, normalizeServerUrl } from "../api/client";
import { PodwaffleMediaModule } from "../native-media";

const CREDENTIALS_KEY = "podwaffle.credentials.v1";
const SNAPSHOT_KEY = "podwaffle.snapshot.v1";

interface Credentials {
  serverUrl: string;
  token: string;
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
  logout: () => Promise<void>;
}

function errorMessage(error: unknown): string {
  if (error instanceof TypeError) {
    return "Could not reach the server. Check the address and your network.";
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

async function clearPersistedState(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(CREDENTIALS_KEY),
    AsyncStorage.removeItem(SNAPSHOT_KEY),
  ]);
}

async function configureNative(
  credentials: Credentials,
  session: Session,
): Promise<void> {
  try {
    await PodwaffleMediaModule.configure({
      serverBaseUrl: credentials.serverUrl,
      deviceId: session.device.id,
      deviceToken: credentials.token,
      profileId: session.profile.id,
      skipBackSeconds: 15,
      skipForwardSeconds: 30,
    });
  } catch {
    // A native module is unavailable in web/test shells; authentication remains usable.
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

  restore: async () => {
    try {
      const [credentialsJson, snapshotJson] = await Promise.all([
        SecureStore.getItemAsync(CREDENTIALS_KEY),
        AsyncStorage.getItem(SNAPSHOT_KEY),
      ]);
      if (!credentialsJson) {
        set({ status: "signed-out", connection: "offline" });
        return;
      }
      const credentials = JSON.parse(credentialsJson) as Credentials;
      const snapshot = snapshotJson
        ? (JSON.parse(snapshotJson) as Snapshot)
        : null;
      set({
        status: "authenticated",
        connection: "checking",
        credentials,
        snapshot,
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
    await SecureStore.setItemAsync(
      CREDENTIALS_KEY,
      JSON.stringify(credentials),
    );
    const snapshot = await api.snapshot(serverUrl, result.token);
    await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
    await configureNative(credentials, result.session);
    set({
      status: "authenticated",
      connection: "online",
      credentials,
      session: result.session,
      snapshot,
      lastSyncAt: new Date().toISOString(),
      error: null,
    });
  },

  refresh: async () => {
    const { credentials, snapshot } = get();
    if (!credentials) return;
    set({ connection: "checking" });
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
      if (nextSnapshot) {
        await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(nextSnapshot));
      }
      await configureNative(credentials, session);
      set({
        status: "authenticated",
        connection: "online",
        session,
        snapshot: nextSnapshot,
        lastSyncAt: new Date().toISOString(),
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
        });
        return;
      }
      set({ connection: "offline", error: errorMessage(error) });
    }
  },

  logout: async () => {
    await clearPersistedState();
    set({
      status: "signed-out",
      connection: "offline",
      credentials: null,
      session: null,
      snapshot: null,
      lastSyncAt: null,
      error: null,
    });
  },
}));

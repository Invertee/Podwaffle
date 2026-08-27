import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import { api } from "../api/client";
import { playbackController } from "../playback/controller";
import { useAuthStore } from "../stores/auth";
import { syncRuntime } from "./runtime";

const PUSH_WAKE_TASK = "podwaffle.push-wake.v1";

async function synchronizeFromPush(): Promise<void> {
  const initial = useAuthStore.getState();
  if (initial.status === "restoring") await initial.restore();
  const current = useAuthStore.getState();
  if (current.status !== "authenticated" || !current.credentials) return;
  // A playback wake-up should claim the durable command before doing the more
  // expensive full-profile refresh. This keeps background controls responsive.
  await syncRuntime.processPendingCommands();
  await current.refresh();
  await playbackController.flushPendingPlayback();
}

TaskManager.defineTask(PUSH_WAKE_TASK, async () => {
  try {
    await synchronizeFromPush();
  } catch {
    // Push delivery is advisory. Foreground REST/WebSocket catch-up remains
    // authoritative when Android limits or interrupts background execution.
  }
});

export async function registerPushWake(): Promise<() => void> {
  if (Platform.OS !== "android") return () => undefined;
  const auth = useAuthStore.getState();
  if (auth.status !== "authenticated" || !auth.credentials) {
    return () => undefined;
  }
  const config = await api.pushConfig(
    auth.credentials.serverUrl,
    auth.credentials.token,
  );
  if (!config.enabled) return () => undefined;

  await Notifications.setNotificationChannelAsync("podwaffle-sync", {
    name: "Podwaffle background sync",
    importance: Notifications.AndroidImportance.MIN,
    sound: null,
    vibrationPattern: null,
  });
  if (!(await TaskManager.isTaskRegisteredAsync(PUSH_WAKE_TASK))) {
    await Notifications.registerTaskAsync(PUSH_WAKE_TASK);
  }

  const registerToken = async (registrationToken: string) => {
    const credentials = useAuthStore.getState().credentials;
    if (!credentials) return;
    await api.registerPush(credentials.serverUrl, credentials.token, {
      registrationToken,
      appVersion: Constants.expoConfig?.version,
      runtimeVersion: String(
        Constants.expoConfig?.extra?.nativeRuntimeVersion ?? "",
      ),
    });
  };

  const deviceToken = await Notifications.getDevicePushTokenAsync();
  if (typeof deviceToken.data === "string") {
    await registerToken(deviceToken.data);
  }
  const tokenSubscription = Notifications.addPushTokenListener((token) => {
    if (typeof token.data === "string") {
      void registerToken(token.data).catch(() => undefined);
    }
  });
  const receiveSubscription = Notifications.addNotificationReceivedListener(
    () => void synchronizeFromPush(),
  );
  return () => {
    tokenSubscription.remove();
    receiveSubscription.remove();
  };
}

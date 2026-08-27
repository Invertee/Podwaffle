import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import { api } from "../api/client";
import { playbackController } from "../playback/controller";
import { PodwaffleMediaModule } from "../native-media";
import { notificationJoinCode, useAuthStore } from "../stores/auth";
import { syncRuntime } from "./runtime";

const PUSH_WAKE_TASK = "podwaffle.push-wake.v1";
const MESSAGE_CHANNEL_ID = "podwaffle-messages";

type PushData = Record<string, unknown>;

function asPushData(value: unknown): PushData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const outer = value as PushData;
  const nested = outer.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as PushData;
  }
  return outer;
}

async function displayEncryptedNotification(data: PushData): Promise<void> {
  const joinCode = await notificationJoinCode();
  if (!joinCode) return;
  const content = await PodwaffleMediaModule.decryptNotification(
    data,
    joinCode,
  );
  await Notifications.scheduleNotificationAsync({
    identifier:
      typeof data.ciphertext === "string"
        ? `podwaffle-message-${data.ciphertext.slice(0, 32)}`
        : undefined,
    content: {
      title: content.title,
      body: content.message,
      sound: "default",
      data: { kind: "podwaffle-local-notification" },
    },
    trigger: { channelId: MESSAGE_CHANNEL_ID },
  });
}

async function handlePush(value: unknown): Promise<void> {
  const data = asPushData(value);
  if (data?.kind === "notification") {
    await displayEncryptedNotification(data);
    return;
  }
  await synchronizeFromPush();
}

Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
});

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

TaskManager.defineTask(PUSH_WAKE_TASK, async ({ data }) => {
  try {
    await handlePush(data);
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
  await Notifications.setNotificationChannelAsync(MESSAGE_CHANNEL_ID, {
    name: "Podwaffle messages",
    description: "Messages sent to this profile from Home Assistant",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    vibrationPattern: [0, 250, 150, 250],
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
    (notification) => {
      const data = asPushData(notification.request.content.data);
      if (data?.kind !== "notification") void synchronizeFromPush();
    },
  );
  return () => {
    tokenSubscription.remove();
    receiveSubscription.remove();
  };
}

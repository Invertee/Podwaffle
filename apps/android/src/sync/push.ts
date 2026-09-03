import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import { api } from "../api/client";
import { playbackController } from "../playback/controller";
import {
  PodwaffleMediaModule,
  type NativeNotificationDisplayResult,
} from "../native-media";
import { notificationJoinCode, useAuthStore } from "../stores/auth";
import {
  asPushData,
  isVisibleLocalNotification,
  type PushData,
} from "./pushPayload";
import {
  pushErrorMessage,
  recordPushDiagnostic,
  type PushDiagnosticLevel,
} from "./pushDiagnostics";
import { syncRuntime } from "./runtime";

const PUSH_WAKE_TASK = "podwaffle.push-wake.v1";
const MESSAGE_CHANNEL_ID = "podwaffle-messages";
const displayedMessageIds = new Set<string>();

type PushSource = "background" | "foreground";

async function logPush(
  event: string,
  detail?: unknown,
  level: PushDiagnosticLevel = "info",
): Promise<void> {
  await recordPushDiagnostic(event, detail, level).catch(() => undefined);
}

function objectKeys(value: unknown): string[] {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value as Record<string, unknown>).sort()
    : [];
}

function pushEnvelopeSummary(value: unknown, data: PushData | null) {
  const outer =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const nested =
    outer?.data &&
    typeof outer.data === "object" &&
    !Array.isArray(outer.data)
      ? (outer.data as Record<string, unknown>)
      : null;
  return {
    kind: typeof data?.kind === "string" ? data.kind : "unknown",
    outerKeys: objectKeys(value),
    nestedKeys: objectKeys(nested),
    parsedKeys: objectKeys(data),
    hasDataString:
      typeof outer?.dataString === "string" ||
      typeof nested?.dataString === "string",
  };
}

function messageIdentifier(data: PushData): string {
  return typeof data.ciphertext === "string"
    ? `podwaffle-message-${data.ciphertext.slice(0, 32)}`
    : `podwaffle-message-${Date.now()}`;
}

async function displayEncryptedNotification(data: PushData): Promise<void> {
  const identifier = messageIdentifier(data);
  if (displayedMessageIds.has(identifier)) {
    await logPush("push.notification.duplicate_ignored", { identifier });
    return;
  }

  const joinCode = await notificationJoinCode();
  if (!joinCode) {
    await logPush(
      "push.notification.decrypt_key_missing",
      {
        version: typeof data.v === "string" ? data.v : null,
        ciphertextLength:
          typeof data.ciphertext === "string" ? data.ciphertext.length : 0,
      },
      "error",
    );
    throw new Error(
      "The notification join code is not stored. Save it in Settings > Push console.",
    );
  }

  displayedMessageIds.add(identifier);
  try {
    await logPush("push.notification.decrypt_started", {
      identifier,
      version: typeof data.v === "string" ? data.v : null,
    });
    const content = await PodwaffleMediaModule.decryptNotification(
      data,
      joinCode,
    );
    await logPush("push.notification.decrypt_succeeded", {
      identifier,
      titleLength: content.title.length,
      messageLength: content.message.length,
    });

    const result = await PodwaffleMediaModule.showMessageNotification({
      identifier,
      title: content.title,
      message: content.message,
    });
    await logPush(
      result.shown
        ? "push.notification.display_succeeded"
        : "push.notification.display_blocked",
      {
        identifier,
        notificationId: result.notificationId,
        notificationsEnabled: result.notificationsEnabled,
        channelImportance: result.channelImportance,
        reason: result.reason,
      },
      result.shown ? "info" : "error",
    );
    if (!result.shown) {
      throw new Error(result.reason ?? "Android did not display the notification");
    }
  } catch (error) {
    displayedMessageIds.delete(identifier);
    await logPush(
      "push.notification.failed",
      { identifier, error: pushErrorMessage(error) },
      "error",
    );
    throw error;
  }
}

async function handlePush(value: unknown, source: PushSource): Promise<void> {
  const data = asPushData(value);
  await logPush(`push.${source}.received`, pushEnvelopeSummary(value, data));
  if (!data) {
    await logPush(`push.${source}.invalid_payload`, undefined, "warning");
    return;
  }
  if (data.kind === "podwaffle-local-notification") return;
  if (data.kind === "notification") {
    await displayEncryptedNotification(data);
    return;
  }
  await logPush(`push.${source}.sync_started`, {
    kind: typeof data.kind === "string" ? data.kind : "unknown",
  });
  await synchronizeFromPush();
  await logPush(`push.${source}.sync_completed`, {
    kind: typeof data.kind === "string" ? data.kind : "unknown",
  });
}

Notifications.setNotificationHandler({
  handleNotification: (notification) => {
    const shouldDisplay = isVisibleLocalNotification(
      notification.request.content.data,
    );
    void logPush("push.foreground.handler", {
      shouldDisplay,
      keys: objectKeys(notification.request.content.data),
    });
    return Promise.resolve({
      // Remote FCM data messages remain silent. Decrypted Home Assistant
      // messages are posted directly by Android's NotificationManager.
      shouldShowAlert: shouldDisplay,
      shouldPlaySound: shouldDisplay,
      shouldSetBadge: false,
    });
  },
});

async function synchronizeFromPush(): Promise<void> {
  const initial = useAuthStore.getState();
  if (initial.status === "restoring") await initial.restore();
  const current = useAuthStore.getState();
  if (current.status !== "authenticated" || !current.credentials) {
    await logPush(
      "push.sync.skipped_not_authenticated",
      { status: current.status },
      "warning",
    );
    return;
  }
  // A playback wake-up should claim the durable command before doing the more
  // expensive full-profile refresh. This keeps background controls responsive.
  await syncRuntime.processPendingCommands();
  await current.refresh();
  await playbackController.flushPendingPlayback();
}

TaskManager.defineTask(PUSH_WAKE_TASK, async ({ data, error, executionInfo }) => {
  await logPush("push.background.task_started", {
    taskName: executionInfo?.taskName ?? PUSH_WAKE_TASK,
    hasError: Boolean(error),
  });
  if (error) {
    await logPush(
      "push.background.task_error",
      pushErrorMessage(error),
      "error",
    );
    return;
  }
  try {
    await handlePush(data, "background");
  } catch (taskError) {
    await logPush(
      "push.background.processing_failed",
      pushErrorMessage(taskError),
      "error",
    );
  }
});

async function ensureChannels(): Promise<void> {
  await Notifications.setNotificationChannelAsync("podwaffle-sync", {
    name: "Podwaffle background sync",
    importance: Notifications.AndroidImportance.MIN,
    sound: null,
    vibrationPattern: null,
  });
  const channel = await Notifications.setNotificationChannelAsync(
    MESSAGE_CHANNEL_ID,
    {
      name: "Podwaffle messages",
      description: "Messages sent to this profile from Home Assistant",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      vibrationPattern: [0, 250, 150, 250],
    },
  );
  await logPush("push.channels.ready", {
    messageChannelImportance: channel?.importance ?? null,
  });
}

export async function sendPushDiagnosticTestNotification(): Promise<NativeNotificationDisplayResult> {
  await ensureChannels();
  const permission = await Notifications.getPermissionsAsync();
  await logPush("push.test.permission", {
    status: permission.status,
    granted: permission.granted,
    canAskAgain: permission.canAskAgain,
  });
  const result = await PodwaffleMediaModule.showMessageNotification({
    identifier: `podwaffle-test-${Date.now()}`,
    title: "Podwaffle notification test",
    message: "The Android message channel is working.",
  });
  await logPush(
    result.shown ? "push.test.display_succeeded" : "push.test.display_blocked",
    result,
    result.shown ? "info" : "error",
  );
  return result;
}

export async function registerPushWake(): Promise<() => void> {
  if (Platform.OS !== "android") return () => undefined;
  await logPush("push.register.started", {
    appVersion: Constants.expoConfig?.version ?? null,
    runtimeVersion: String(
      Constants.expoConfig?.extra?.nativeRuntimeVersion ?? "",
    ),
  });

  try {
    const auth = useAuthStore.getState();
    if (auth.status !== "authenticated" || !auth.credentials) {
      await logPush(
        "push.register.skipped_not_authenticated",
        { status: auth.status },
        "warning",
      );
      return () => undefined;
    }

    const config = await api.pushConfig(
      auth.credentials.serverUrl,
      auth.credentials.token,
    );
    await logPush("push.register.server_config", {
      enabled: config.enabled,
      projectId: config.projectId,
      androidAppIdPresent: Boolean(config.androidAppId),
    });
    if (!config.enabled) return () => undefined;

    await ensureChannels();
    const permission = await Notifications.getPermissionsAsync();
    const joinCodePresent = Boolean(await notificationJoinCode());
    await logPush(
      "push.register.device_state",
      {
        permissionStatus: permission.status,
        permissionGranted: permission.granted,
        canAskAgain: permission.canAskAgain,
        notificationKeyStored: joinCodePresent,
      },
      permission.granted && joinCodePresent ? "info" : "warning",
    );

    const taskRegistered = await TaskManager.isTaskRegisteredAsync(
      PUSH_WAKE_TASK,
    );
    if (!taskRegistered) {
      await Notifications.registerTaskAsync(PUSH_WAKE_TASK);
    }
    await logPush("push.register.background_task", {
      alreadyRegistered: taskRegistered,
      registered: true,
    });

    const registerToken = async (registrationToken: string) => {
      const credentials = useAuthStore.getState().credentials;
      if (!credentials) {
        await logPush(
          "push.token.registration_skipped",
          { reason: "credentials-missing" },
          "warning",
        );
        return;
      }
      await logPush("push.token.registration_started", {
        tokenLength: registrationToken.length,
      });
      await api.registerPush(credentials.serverUrl, credentials.token, {
        registrationToken,
        appVersion: Constants.expoConfig?.version,
        runtimeVersion: String(
          Constants.expoConfig?.extra?.nativeRuntimeVersion ?? "",
        ),
      });
      await logPush("push.token.registration_succeeded", {
        tokenLength: registrationToken.length,
      });
    };

    const deviceToken = await Notifications.getDevicePushTokenAsync();
    await logPush("push.token.received", {
      type: deviceToken.type,
      stringToken: typeof deviceToken.data === "string",
      tokenLength:
        typeof deviceToken.data === "string" ? deviceToken.data.length : 0,
    });
    if (typeof deviceToken.data === "string") {
      await registerToken(deviceToken.data);
    }

    const tokenSubscription = Notifications.addPushTokenListener((token) => {
      if (typeof token.data === "string") {
        void registerToken(token.data).catch((tokenError) =>
          logPush(
            "push.token.refresh_failed",
            pushErrorMessage(tokenError),
            "error",
          ),
        );
      }
    });
    const receiveSubscription = Notifications.addNotificationReceivedListener(
      (notification) => {
        void handlePush(notification.request.content.data, "foreground").catch(
          (receiveError) =>
            logPush(
              "push.foreground.processing_failed",
              pushErrorMessage(receiveError),
              "error",
            ),
        );
      },
    );
    const droppedSubscription = Notifications.addNotificationsDroppedListener(
      () => {
        void logPush(
          "push.messages_dropped",
          "FCM reported that one or more pending messages were dropped",
          "warning",
        );
      },
    );
    await logPush("push.register.completed");

    return () => {
      tokenSubscription.remove();
      receiveSubscription.remove();
      droppedSubscription.remove();
      void logPush("push.register.listeners_removed");
    };
  } catch (error) {
    await logPush("push.register.failed", pushErrorMessage(error), "error");
    throw error;
  }
}

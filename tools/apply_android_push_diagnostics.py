from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    content = file_path.read_text(encoding="utf-8")
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one match in {path}, found {count}")
    file_path.write_text(content.replace(old, new, 1), encoding="utf-8")


replace_once(
    "apps/android/modules/podwaffle-media/android/src/main/java/com/podwaffle/media/PodwaffleMediaModule.kt",
    '''        AsyncFunction("decryptNotification") { input: Map<String, Any?>, joinCode: String ->
            NotificationCrypto.decrypt(input, joinCode)
        }

        AsyncFunction("bind") {''',
    '''        AsyncFunction("decryptNotification") { input: Map<String, Any?>, joinCode: String ->
            NotificationCrypto.decrypt(input, joinCode)
        }

        AsyncFunction("showMessageNotification") { input: Map<String, Any?> ->
            PodwaffleNotificationPresenter.show(context, input)
        }

        AsyncFunction("bind") {''',
)

replace_once(
    "apps/android/modules/podwaffle-media/src/index.ts",
    '''export interface DecryptedNotification {
  title: string;
  message: string;
}

export const MEDIA_EVENTS = {''',
    '''export interface DecryptedNotification {
  title: string;
  message: string;
}

export interface NativeNotificationDisplayResult {
  shown: boolean;
  notificationId: number;
  notificationsEnabled: boolean;
  channelImportance: number | null;
  reason: string | null;
}

export const MEDIA_EVENTS = {''',
)

replace_once(
    "apps/android/modules/podwaffle-media/src/index.ts",
    '''  decryptNotification(
    input: Record<string, unknown>,
    joinCode: string,
  ): Promise<DecryptedNotification>;
  bind(): Promise<NativePlaybackState>;''',
    '''  decryptNotification(
    input: Record<string, unknown>,
    joinCode: string,
  ): Promise<DecryptedNotification>;
  showMessageNotification(input: {
    identifier: string;
    title: string;
    message: string;
  }): Promise<NativeNotificationDisplayResult>;
  bind(): Promise<NativePlaybackState>;''',
)

replace_once(
    "apps/android/modules/podwaffle-media/src/index.ts",
    '''  decryptNotification(
    input: Record<string, unknown>,
    joinCode: string,
  ): Promise<DecryptedNotification> {
    return nativeModule.decryptNotification(input, joinCode);
  },
  bind(): Promise<NativePlaybackState> {''',
    '''  decryptNotification(
    input: Record<string, unknown>,
    joinCode: string,
  ): Promise<DecryptedNotification> {
    return nativeModule.decryptNotification(input, joinCode);
  },
  showMessageNotification(input: {
    identifier: string;
    title: string;
    message: string;
  }): Promise<NativeNotificationDisplayResult> {
    return nativeModule.showMessageNotification(input);
  },
  bind(): Promise<NativePlaybackState> {''',
)

replace_once(
    "apps/android/src/native-media/index.ts",
    '''  type NativeEpisodeCompletion,
} from "../../modules/podwaffle-media/src/index";''',
    '''  type NativeEpisodeCompletion,
  type NativeNotificationDisplayResult,
} from "../../modules/podwaffle-media/src/index";''',
)

replace_once(
    "apps/android/src/stores/auth.ts",
    '''export async function notificationJoinCode(): Promise<string | null> {
  return SecureStore.getItemAsync(NOTIFICATION_JOIN_CODE_KEY);
}
''',
    '''export async function notificationJoinCode(): Promise<string | null> {
  return SecureStore.getItemAsync(NOTIFICATION_JOIN_CODE_KEY);
}

export async function saveNotificationJoinCode(value: string): Promise<void> {
  const joinCode = value.trim();
  if (!joinCode) throw new Error("The notification join code cannot be empty.");
  await SecureStore.setItemAsync(NOTIFICATION_JOIN_CODE_KEY, joinCode);
}
''',
)

replace_once(
    "apps/android/src/app/(tabs)/profile.tsx",
    '''import { api } from "../../api/client";
import { updateProfilePlaybackSettings } from "../../api/profileSettings";''',
    '''import { api } from "../../api/client";
import { updateProfilePlaybackSettings } from "../../api/profileSettings";
import { PushDiagnosticsCard } from "../../components/PushDiagnosticsCard";''',
)

replace_once(
    "apps/android/src/app/(tabs)/profile.tsx",
    '''        </Pressable>
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.disconnectButton,''',
    '''        </Pressable>
      </View>

      <PushDiagnosticsCard />

      <Pressable
        style={({ pressed }) => [
          styles.disconnectButton,''',
)

replace_once(
    "apps/android/app.config.ts",
    '  version: "0.4.32",',
    '  version: "0.4.33",',
)
replace_once(
    "apps/android/app.config.ts",
    '    buildNumber: "34",',
    '    buildNumber: "35",',
)
replace_once(
    "apps/android/app.config.ts",
    "    versionCode: 36,",
    "    versionCode: 37,",
)
replace_once(
    "apps/android/app.config.ts",
    '    nativeRuntimeVersion: "0.4-native-26",',
    '    nativeRuntimeVersion: "0.4-native-27",',
)
replace_once(
    "apps/android/package.json",
    '  "version": "0.4.32",',
    '  "version": "0.4.33",',
)

replace_once(
    "apps/android/modules/podwaffle-media/package.json",
    '  "version": "0.4.20",',
    '  "version": "0.4.21",',
)
replace_once(
    "apps/android/modules/podwaffle-media/android/build.gradle",
    "version = '0.4.20'",
    "version = '0.4.21'",
)
replace_once(
    "apps/android/modules/podwaffle-media/android/build.gradle",
    "    versionCode 24",
    "    versionCode 25",
)
replace_once(
    "apps/android/modules/podwaffle-media/android/build.gradle",
    '    versionName "0.4.20"',
    '    versionName "0.4.21"',
)

replace_once(
    "CHANGELOG.md",
    "## Unreleased\n\n",
    '''## Unreleased

- Replaced background local scheduling for encrypted Home Assistant messages with
  direct Android NotificationManager delivery, added persistent on-device push
  diagnostics and a notification-channel test to the Settings status page, and
  added a secure join-code repair path for devices upgraded from builds that did
  not retain the notification decryption key. Updated Android to 0.4.33 /
  versionCode 37 / native runtime 0.4-native-27.
''',
)

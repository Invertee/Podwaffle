import type { ExpoConfig, ConfigContext } from "expo/config";

const sharedPodwaffleIcon = "../../podwaffle/icon.png";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Podwaffle",
  slug: "podwaffle",
  version: "0.4.12",
  orientation: "portrait",
  icon: sharedPodwaffleIcon,
  scheme: "podwaffle",
  userInterfaceStyle: "dark",
  newArchEnabled: false,
  splash: {
    image: sharedPodwaffleIcon,
    resizeMode: "contain",
    backgroundColor: "#0D1B2A",
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: "com.podwaffle.app",
    buildNumber: "16",
  },
  android: {
    versionCode: 16,
    adaptiveIcon: {
      foregroundImage: sharedPodwaffleIcon,
      backgroundColor: "#0D1B2A",
    },
    package: "com.podwaffle.app",
    permissions: [
      "android.permission.INTERNET",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.WAKE_LOCK",
      "android.permission.RECEIVE_BOOT_COMPLETED",
      "android.permission.ACCESS_NETWORK_STATE",
      "android.permission.DOWNLOAD_WITHOUT_NOTIFICATION",
    ],
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-asset",
    "expo-secure-store",
    "./plugins/with-podwaffle-cast-volume.js",
    [
      "expo-build-properties",
      {
        android: {
          minSdkVersion: 26,
          compileSdkVersion: 35,
          targetSdkVersion: 35,
        },
      },
    ],
    [
      "expo-splash-screen",
      {
        image: sharedPodwaffleIcon,
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#0D1B2A",
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    nativeRuntimeVersion: "0.4-native-15",
    apiMinVersion: 1,
  },
});

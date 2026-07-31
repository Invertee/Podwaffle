import type { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Podwaffle",
  slug: "podwaffle",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme: "podwaffle",
  userInterfaceStyle: "dark",
  newArchEnabled: false,
  splash: {
    image: "./assets/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#0D1B2A",
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: "com.podwaffle.app",
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
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
    ],
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    [
      "expo-build-properties",
      {
        android: {
          minSdkVersion: 26,
          // Media3 1.5 requires API 35 at compile time. Runtime targeting
          // remains Android 14 / API 34 until the release hardening pass.
          compileSdkVersion: 35,
          targetSdkVersion: 34,
        },
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
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
    // App version metadata consumed by the native diagnostics screen
    nativeRuntimeVersion: "0.1-native-1",
    apiMinVersion: 1,
  },
});

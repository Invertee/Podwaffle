# Podwaffle Android Setup & Matrix Documentation

## 1. Overview
The Podwaffle Android client is built with Expo / React Native and Kotlin AndroidX Media3 (`MediaSessionService`).

## 2. Supported Device & OS Matrix

| Surface | Minimum Version | Target Version |
|---|---|---|
| Android OS | Android 8.0 (API level 26) | Android 15 (API level 35) |
| Architecture | `arm64-v8a`, `armeabi-v7a`, `x86_64` | `arm64-v8a` |
| Java JDK | Java 17 | Java 17 |
| Media Engine | AndroidX Media3 1.8.0 | AndroidX Media3 1.8.0 |

## 3. Local Development & Build Commands

### Prerequisites
- Node.js >= 24
- pnpm >= 10
- Android Studio with Android SDK 35 installed
- JDK 17 (`JAVA_HOME` set)

### Running locally
1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Generate native Android folder via Expo Prebuild:
   ```bash
   cd apps/android
   npx expo prebuild --platform android
   ```

3. Build and launch debug APK on emulator/device:
   ```bash
   npx expo run:android
   ```

### Verification Suite
- Typecheck: `pnpm --filter @podwaffle/android typecheck`
- Lint: `pnpm lint`
- Monorepo tests: `pnpm test`

import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Redirect } from "expo-router";
import type { PublicProfile } from "@podwaffle/contracts";

import { useAuthStore } from "../stores/auth";
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
} from "../styles/tokens";

export default function JoinScreen() {
  const status = useAuthStore((state) => state.status);
  const storedError = useAuthStore((state) => state.error);
  const validateServer = useAuthStore((state) => state.validateServer);
  const join = useAuthStore((state) => state.join);
  const [serverUrl, setServerUrl] = useState("");
  const [profiles, setProfiles] = useState<PublicProfile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [deviceName, setDeviceName] = useState("Android device");
  const [joinCode, setJoinCode] = useState("");
  const [validatedUrl, setValidatedUrl] = useState("");
  const [busy, setBusy] = useState<"validate" | "join" | null>(null);
  const [message, setMessage] = useState<string | null>(storedError);

  if (status === "authenticated") return <Redirect href="/(tabs)" />;

  async function handleValidate() {
    setBusy("validate");
    setMessage(null);
    try {
      const result = await validateServer(serverUrl);
      setServerUrl(result.serverUrl);
      setValidatedUrl(result.serverUrl);
      setProfiles(result.profiles);
      setProfileId(result.profiles[0]?.id ?? "");
      setMessage(
        result.profiles.length
          ? `Connected — ${result.profiles.length} profile${result.profiles.length === 1 ? "" : "s"} available.`
          : "Connected, but this server has no enabled profiles.",
      );
    } catch (error) {
      setValidatedUrl("");
      setProfiles([]);
      setMessage(error instanceof Error ? error.message : "Connection failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleJoin() {
    if (!profileId || !deviceName.trim() || !joinCode) return;
    setBusy("join");
    setMessage(null);
    try {
      await join({
        serverUrl: validatedUrl,
        profileId,
        deviceName,
        joinCode,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not join.");
    } finally {
      setBusy(null);
    }
  }

  const canJoin =
    Boolean(validatedUrl && profileId && deviceName.trim() && joinCode) &&
    !busy;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>PW</Text>
          </View>
          <Text style={styles.eyebrow}>YOUR PODCASTS, IN SYNC</Text>
          <Text style={styles.title}>Welcome to Podwaffle</Text>
          <Text style={styles.subtitle}>
            Connect this device to your self-hosted server.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Server URL</Text>
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={(value) => {
              setServerUrl(value);
              if (value !== validatedUrl) {
                setValidatedUrl("");
                setProfiles([]);
              }
            }}
            placeholder="https://podcasts.example.com"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!busy}
            accessibilityLabel="Podwaffle server URL"
          />
          <Pressable
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.pressed,
            ]}
            onPress={() => void handleValidate()}
            disabled={Boolean(busy) || !serverUrl.trim()}
            accessibilityRole="button"
          >
            {busy === "validate" ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <Text style={styles.secondaryButtonText}>Check server</Text>
            )}
          </Pressable>

          {validatedUrl ? (
            <>
              <Text style={styles.label}>Profile</Text>
              <View style={styles.profileList}>
                {profiles.map((profile) => {
                  const selected = profile.id === profileId;
                  return (
                    <Pressable
                      key={profile.id}
                      onPress={() => setProfileId(profile.id)}
                      style={[
                        styles.profile,
                        selected && styles.profileSelected,
                      ]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                    >
                      <View
                        style={[styles.radio, selected && styles.radioSelected]}
                      />
                      <Text style={styles.profileText}>
                        {profile.displayName}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.label}>Device name</Text>
              <TextInput
                style={styles.input}
                value={deviceName}
                onChangeText={setDeviceName}
                maxLength={100}
                editable={!busy}
                accessibilityLabel="Device name"
              />

              <Text style={styles.label}>Join code</Text>
              <TextInput
                style={styles.input}
                value={joinCode}
                onChangeText={setJoinCode}
                secureTextEntry
                maxLength={256}
                editable={!busy}
                onSubmitEditing={() => canJoin && void handleJoin()}
                accessibilityLabel="Join code"
              />
            </>
          ) : null}

          {message ? (
            <Text
              style={[
                styles.message,
                validatedUrl ? styles.success : styles.error,
              ]}
              accessibilityLiveRegion="polite"
            >
              {message}
            </Text>
          ) : null}

          {validatedUrl ? (
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                !canJoin && styles.disabled,
                pressed && styles.pressed,
              ]}
              onPress={() => void handleJoin()}
              disabled={!canJoin}
              accessibilityRole="button"
            >
              {busy === "join" ? (
                <ActivityIndicator color={colors.textOnAccent} />
              ) : (
                <Text style={styles.primaryButtonText}>Join Podwaffle</Text>
              )}
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.xl,
  },
  brand: { alignItems: "center", gap: spacing.sm },
  logo: {
    width: 68,
    height: 68,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
    marginBottom: spacing.sm,
  },
  logoText: {
    color: colors.textOnAccent,
    fontSize: fontSizes.xxl,
    fontWeight: fontWeights.bold,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
    letterSpacing: 1.4,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSizes.xxxl,
    fontWeight: fontWeights.bold,
    textAlign: "center",
  },
  subtitle: { color: colors.textSecondary, fontSize: fontSizes.md },
  card: {
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  label: {
    color: colors.textPrimary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    marginTop: spacing.sm,
  },
  input: {
    minHeight: 50,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgPrimary,
    color: colors.textPrimary,
    fontSize: fontSizes.md,
  },
  secondaryButton: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  secondaryButtonText: {
    color: colors.accent,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
  },
  primaryButton: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    marginTop: spacing.sm,
  },
  primaryButtonText: {
    color: colors.textOnAccent,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.bold,
  },
  profileList: { gap: spacing.sm },
  profile: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.bgPrimary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  profileSelected: { borderColor: colors.accent },
  profileText: { color: colors.textPrimary, fontSize: fontSizes.md },
  radio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.textMuted,
  },
  radioSelected: {
    borderWidth: 5,
    borderColor: colors.accent,
    backgroundColor: colors.textOnAccent,
  },
  message: { fontSize: fontSizes.sm, lineHeight: 19, marginTop: spacing.sm },
  success: { color: colors.success },
  error: { color: colors.error },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
});

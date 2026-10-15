import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const rawOptionsSchema = z.object({
  profiles: z.string().min(1),
  join_code: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(3000),
  feed_refresh_minutes: z.number().int().positive().default(30),
  analysis_server_url: z
    .union([
      z.literal(""),
      z
        .url()
        .refine((value) => /^https?:\/\//.test(value), "Use HTTP or HTTPS"),
    ])
    .default(""),
  sync_event_retention_days: z.number().int().min(1).default(30),
  history_retention_days: z.number().int().min(1).default(365),
  artwork_cache_mb: z.number().int().nonnegative().default(500),
  analysis_enabled: z.boolean().default(true),
  whisper_model: z.enum(["tiny.en", "base.en"]).default("tiny.en"),
  whisper_threads: z.number().int().min(1).max(64).default(2),
  sample_seconds: z.number().int().min(30).max(3600).default(900),
  max_audio_mb: z.number().int().min(1).max(2048).default(512),
  job_timeout_minutes: z.number().int().min(1).max(1440).default(60),
  classifier: z.enum(["rules", "jev"]).default("rules"),
  jev_api_key: z.string().default(""),
  jev_model: z.string().default("typesafe-jev-1.13.0"),
  jev_timeout_seconds: z.number().int().min(5).max(300).default(30),
  schedule_enabled: z.boolean().default(true),
  schedule_start: z.string().default("23:00"),
  schedule_end: z.string().default("07:00"),
  schedule_timezone: z.string().default("Europe/London"),
  episode_cache_mb: z.number().int().min(0).max(1000000).default(5000),
  log_level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  cast_receiver_app_id: z.string().default(""),
  cast_progress_watchdog: z.boolean().default(false),
  firebase_enabled: z.boolean().default(false),
  firebase_project_id: z.string().default(""),
  firebase_service_account_path: z
    .string()
    .default("/data/firebase-service-account.json"),
  firebase_android_config_path: z
    .string()
    .default("/data/google-services.json"),
  android_release_manifest_path: z
    .string()
    .default("/data/android-release.json"),
  backup_retention_count: z.number().int().min(1).max(100).default(7),
});

export interface AppConfig extends z.infer<typeof rawOptionsSchema> {
  profileNames: string[];
  dataDir: string;
  databasePath: string;
  episodeCacheDir: string;
}

function parseProfileNames(value: string): string[] {
  const names = value.split(",").map((name) => name.trim());
  if (names.some((name) => name.length === 0)) {
    throw new Error("Profile names may not be blank");
  }
  const normalized = names.map((name) => name.toLocaleLowerCase());
  if (new Set(normalized).size !== names.length) {
    throw new Error("Profile names must be unique");
  }
  return names;
}

export async function loadConfig(
  optionsPath = process.env.PODWAFFLE_OPTIONS_PATH ??
    (process.env.PODWAFFLE_DEV_MODE === "true"
      ? resolve(import.meta.dirname, "../config/development.json")
      : "/data/options.json"),
): Promise<AppConfig> {
  const raw = rawOptionsSchema.parse(
    JSON.parse(await readFile(optionsPath, "utf8")) as unknown,
  );
  const dataDir =
    process.env.PODWAFFLE_DATA_DIR ??
    (process.env.PODWAFFLE_DEV_MODE === "true"
      ? resolve(import.meta.dirname, "../.data")
      : resolve(optionsPath, ".."));
  return {
    ...raw,
    profileNames: parseProfileNames(raw.profiles),
    dataDir,
    databasePath: resolve(dataDir, "podwaffle.sqlite"),
    episodeCacheDir:
      process.env.PODWAFFLE_EPISODE_CACHE_DIR ??
      resolve(dataDir, "episode-cache"),
  };
}

export function configForTest(
  dataDir: string,
  overrides: Partial<AppConfig> = {},
): AppConfig {
  const base = rawOptionsSchema.parse({
    profiles: "Sam, Guest",
    join_code: "test-secret",
  });
  return {
    ...base,
    profileNames: ["Sam", "Guest"],
    dataDir,
    databasePath: resolve(dataDir, "podwaffle.sqlite"),
    episodeCacheDir: resolve(dataDir, "episode-cache"),
    ...overrides,
  };
}

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const rawOptionsSchema = z.object({
  profiles: z.string().min(1),
  join_code: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(3000),
  feed_refresh_minutes: z.number().int().positive().default(30),
  sync_event_retention_days: z.number().int().min(1).default(30),
  history_retention_days: z.number().int().min(1).default(365),
  artwork_cache_mb: z.number().int().nonnegative().default(500),
  log_level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  cast_receiver_app_id: z.string().default(""),
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
    ...overrides,
  };
}

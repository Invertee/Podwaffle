import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { cert, deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getMessaging, type BatchResponse } from "firebase-admin/messaging";
import type { SyncEvent } from "@podwaffle/contracts";

import type { AppConfig } from "../config.js";
import type { PodwaffleDatabase } from "../db/connection.js";
import { log } from "../logging.js";
import type { SyncService } from "../sync/service.js";
import { encryptNotification } from "./encryption.js";

interface RegistrationRow {
  id: string;
  device_id: string;
  registration_token: string;
}

interface AndroidFirebaseConfig {
  project_info?: { project_id?: string };
  client?: Array<{
    client_info?: {
      mobilesdk_app_id?: string;
      android_client_info?: { package_name?: string };
    };
  }>;
}

interface FirebaseServiceAccountConfig {
  project_id?: string;
}

const INVALID_TOKEN_CODES = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
]);

export interface PublicPushConfig {
  enabled: boolean;
  projectId: string | null;
  androidAppId: string | null;
}

export type PushHealthStatus =
  "disabled" | "working" | "not_registered" | "error";

export interface PublicPushHealth extends PublicPushConfig {
  status: PushHealthStatus;
  message: string;
  checkedAt: string;
  deviceRegistered: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureCode: string | null;
}

export interface PushDeliveryResult {
  targeted: number;
  accepted: boolean;
}

export class PushService {
  private unsubscribe: (() => void) | undefined;

  private constructor(
    private readonly database: PodwaffleDatabase,
    private readonly firebaseApp: App | null,
    private readonly publicConfig: PublicPushConfig,
    private readonly joinCode: string,
  ) {}

  public static async create(
    config: AppConfig,
    database: PodwaffleDatabase,
  ): Promise<PushService> {
    if (!config.firebase_enabled) {
      return new PushService(
        database,
        null,
        {
          enabled: false,
          projectId: null,
          androidAppId: null,
        },
        config.join_code,
      );
    }

    const [androidConfig, serviceAccount] = await Promise.all([
      readFile(config.firebase_android_config_path, "utf8").then(
        (value) => JSON.parse(value) as AndroidFirebaseConfig,
      ),
      readFile(config.firebase_service_account_path, "utf8").then(
        (value) => JSON.parse(value) as FirebaseServiceAccountConfig,
      ),
    ]);
    const androidClient = androidConfig.client?.find(
      (candidate) =>
        candidate.client_info?.android_client_info?.package_name ===
        "com.podwaffle.app",
    );
    const androidProjectId = androidConfig.project_info?.project_id;
    const projectId = config.firebase_project_id || androidProjectId;
    if (!projectId) {
      throw new Error(
        "Firebase is enabled but no project ID is configured or present in google-services.json",
      );
    }
    if (androidProjectId && androidProjectId !== projectId) {
      throw new Error(
        "firebase_project_id does not match firebase_android_config_path",
      );
    }
    if (serviceAccount.project_id !== projectId) {
      throw new Error(
        "Firebase service-account project_id does not match the configured project",
      );
    }
    if (!androidClient?.client_info?.mobilesdk_app_id) {
      throw new Error(
        "google-services.json does not contain the com.podwaffle.app Android client",
      );
    }

    const firebaseApp = initializeApp(
      {
        credential: cert(config.firebase_service_account_path),
        projectId,
      },
      `podwaffle-${randomUUID()}`,
    );
    return new PushService(
      database,
      firebaseApp,
      {
        enabled: true,
        projectId,
        androidAppId: androidClient.client_info.mobilesdk_app_id,
      },
      config.join_code,
    );
  }

  public config(): PublicPushConfig {
    return this.publicConfig;
  }

  public async health(deviceId: string): Promise<PublicPushHealth> {
    const checkedAt = new Date().toISOString();
    const registration = this.database.db
      .prepare(
        `SELECT registration_token, last_success_at, last_failure_at,
                last_failure_code
         FROM push_registrations WHERE device_id = ?
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(deviceId) as
      | {
          registration_token: string;
          last_success_at: string | null;
          last_failure_at: string | null;
          last_failure_code: string | null;
        }
      | undefined;
    const base = {
      ...this.publicConfig,
      checkedAt,
      deviceRegistered: Boolean(registration),
      lastSuccessAt: registration?.last_success_at ?? null,
      lastFailureAt: registration?.last_failure_at ?? null,
      lastFailureCode: registration?.last_failure_code ?? null,
    };

    if (!this.firebaseApp) {
      return {
        ...base,
        status: "disabled",
        message: "Firebase messaging is disabled on the Podwaffle server.",
      };
    }

    try {
      // Dry-run validates the actual device token when one exists, without
      // displaying or delivering a notification. A topic dry-run still checks
      // the project credentials/API before the first device registers.
      await getMessaging(this.firebaseApp).send(
        registration
          ? {
              token: registration.registration_token,
              data: { source: "podwaffle-device-health-check" },
            }
          : {
              topic: "podwaffle-health-check",
              data: { source: "podwaffle-project-health-check" },
            },
        true,
      );
    } catch (error) {
      const failureCode =
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : "messaging/unknown-error";
      if (registration) {
        this.database.db
          .prepare(
            `UPDATE push_registrations SET last_failure_at = ?,
             last_failure_code = ?, updated_at = ?
             WHERE device_id = ?`,
          )
          .run(checkedAt, failureCode, checkedAt, deviceId);
      }
      return {
        ...base,
        status: "error",
        lastFailureAt: registration ? checkedAt : base.lastFailureAt,
        lastFailureCode: failureCode,
        message:
          error instanceof Error
            ? `Firebase messaging check failed: ${error.message}`
            : "Firebase messaging check failed.",
      };
    }

    if (!base.deviceRegistered) {
      return {
        ...base,
        status: "not_registered",
        message:
          "Firebase is reachable, but this device has not registered for push messaging.",
      };
    }
    this.database.db
      .prepare(
        `UPDATE push_registrations SET last_success_at = ?,
         last_failure_at = NULL, last_failure_code = NULL, updated_at = ?
         WHERE device_id = ?`,
      )
      .run(checkedAt, checkedAt, deviceId);
    return {
      ...base,
      status: "working",
      lastSuccessAt: checkedAt,
      lastFailureAt: null,
      lastFailureCode: null,
      message:
        "Firebase messaging is configured and this device token is valid.",
    };
  }

  public start(sync: SyncService): void {
    if (!this.firebaseApp || this.unsubscribe) return;
    this.unsubscribe = sync.subscribe((profileId, event) => {
      void this.sendProfileUpdate(profileId, event);
    });
  }

  public register(
    deviceId: string,
    input: {
      registrationToken: string;
      appVersion?: string | undefined;
      runtimeVersion?: string | undefined;
    },
  ): { id: string } {
    if (!this.firebaseApp) throw new Error("PUSH_NOT_CONFIGURED");
    const now = new Date().toISOString();
    const existing = this.database.db
      .prepare("SELECT id FROM push_registrations WHERE registration_token = ?")
      .get(input.registrationToken) as { id: string } | undefined;
    const id = existing?.id ?? randomUUID();
    this.database.db
      .prepare(
        `INSERT INTO push_registrations(
           id, device_id, provider, registration_token, app_version,
           runtime_version, created_at, updated_at
         ) VALUES (?, ?, 'fcm', ?, ?, ?, ?, ?)
         ON CONFLICT(registration_token) DO UPDATE SET
           device_id = excluded.device_id,
           app_version = excluded.app_version,
           runtime_version = excluded.runtime_version,
           last_failure_at = NULL,
           last_failure_code = NULL,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        deviceId,
        input.registrationToken,
        input.appVersion ?? null,
        input.runtimeVersion ?? null,
        now,
        now,
      );
    return { id };
  }

  public remove(deviceId: string, registrationId: string): boolean {
    const result = this.database.db
      .prepare("DELETE FROM push_registrations WHERE id = ? AND device_id = ?")
      .run(registrationId, deviceId);
    return Number(result.changes) > 0;
  }

  public async wakePlaybackDevice(
    deviceId: string,
    commandId: string,
  ): Promise<boolean> {
    return this.sendToRegistrations(
      this.registrationsForDevice(deviceId),
      { kind: "playback-command", commandId },
      true,
      `podwaffle-command-${deviceId}`,
    );
  }

  public async sendProfileNotification(
    profileId: string,
    content: { title: string; message: string },
  ): Promise<PushDeliveryResult> {
    const registrations = this.registrationsForProfile(profileId);
    if (registrations.length === 0) {
      return { targeted: 0, accepted: false };
    }
    const encrypted = encryptNotification(this.joinCode, content);
    const accepted = await this.sendToRegistrations(
      registrations,
      { kind: "notification", ...encrypted },
      true,
      undefined,
      24 * 60 * 60_000,
    );
    return { targeted: registrations.length, accepted };
  }

  private async sendProfileUpdate(
    profileId: string,
    event: SyncEvent,
  ): Promise<boolean> {
    const activeDeviceId = (
      event.payload.playback as { activeDeviceId?: unknown } | undefined
    )?.activeDeviceId;
    const registrations = this.registrationsForProfile(profileId).filter(
      (registration) =>
        typeof activeDeviceId !== "string" ||
        registration.device_id !== activeDeviceId,
    );
    return this.sendToRegistrations(
      registrations,
      {
        kind: "sync",
        revision: String(event.revision),
        eventType: event.type,
      },
      false,
      `podwaffle-sync-${profileId}`,
    );
  }

  private registrationsForDevice(deviceId: string): RegistrationRow[] {
    return this.database.db
      .prepare(
        `SELECT pr.id, pr.device_id, pr.registration_token
         FROM push_registrations pr
         JOIN devices d ON d.id = pr.device_id
         WHERE pr.device_id = ? AND d.revoked_at IS NULL`,
      )
      .all(deviceId) as unknown as RegistrationRow[];
  }

  private registrationsForProfile(profileId: string): RegistrationRow[] {
    return this.database.db
      .prepare(
        `SELECT pr.id, pr.device_id, pr.registration_token
         FROM push_registrations pr
         JOIN devices d ON d.id = pr.device_id
         WHERE d.profile_id = ? AND d.platform = 'android'
           AND d.revoked_at IS NULL`,
      )
      .all(profileId) as unknown as RegistrationRow[];
  }

  private async sendToRegistrations(
    registrations: RegistrationRow[],
    data: Record<string, string>,
    urgent: boolean,
    collapseKey: string | undefined,
    ttl = urgent ? 60_000 : 6 * 60 * 60_000,
  ): Promise<boolean> {
    if (!this.firebaseApp || registrations.length === 0) return false;
    let delivered = false;
    for (let offset = 0; offset < registrations.length; offset += 500) {
      const batch = registrations.slice(offset, offset + 500);
      try {
        const response = await getMessaging(
          this.firebaseApp,
        ).sendEachForMulticast({
          tokens: batch.map((item) => item.registration_token),
          data,
          android: {
            priority: urgent ? "high" : "normal",
            ...(collapseKey ? { collapseKey } : {}),
            ttl,
          },
        });
        delivered ||= response.successCount > 0;
        this.applyResults(batch, response);
      } catch (error) {
        log("warn", "push.send_failed", {
          kind: data.kind,
          error: error instanceof Error ? error.message : "Unknown FCM error",
        });
      }
    }
    return delivered;
  }

  private applyResults(
    registrations: RegistrationRow[],
    response: BatchResponse,
  ): void {
    const now = new Date().toISOString();
    this.database.transaction(() => {
      response.responses.forEach((result, index) => {
        const registration = registrations[index];
        if (!registration) return;
        if (result.success) {
          this.database.db
            .prepare(
              `UPDATE push_registrations SET last_success_at = ?,
               last_failure_at = NULL, last_failure_code = NULL, updated_at = ?
               WHERE id = ?`,
            )
            .run(now, now, registration.id);
          return;
        }
        const code = result.error?.code ?? "messaging/unknown-error";
        if (INVALID_TOKEN_CODES.has(code)) {
          this.database.db
            .prepare("DELETE FROM push_registrations WHERE id = ?")
            .run(registration.id);
        } else {
          this.database.db
            .prepare(
              `UPDATE push_registrations SET last_failure_at = ?,
               last_failure_code = ?, updated_at = ? WHERE id = ?`,
            )
            .run(now, code, now, registration.id);
        }
      });
    });
  }

  public async close(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.firebaseApp) await deleteApp(this.firebaseApp);
  }
}

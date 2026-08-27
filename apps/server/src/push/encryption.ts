import {
  createCipheriv,
  pbkdf2Sync,
  randomBytes,
  type BinaryLike,
} from "node:crypto";

import type { PushNotificationInput } from "@podwaffle/contracts";

export const NOTIFICATION_ENCRYPTION_VERSION = "1";
export const NOTIFICATION_KEY_ITERATIONS = 210_000;
export const NOTIFICATION_KEY_BYTES = 32;
export const NOTIFICATION_SALT_BYTES = 16;
export const NOTIFICATION_IV_BYTES = 12;
export const NOTIFICATION_AAD = "podwaffle.notification.v1";
// Keeps the complete base64url-encoded FCM data map below FCM's 4096-byte cap,
// including worst-case UTF-8 content, the GCM tag, and envelope metadata.
export const MAX_NOTIFICATION_PLAINTEXT_BYTES = 2600;

export interface EncryptedNotification {
  v: string;
  salt: string;
  iv: string;
  ciphertext: string;
}

type RandomBytes = (size: number) => Buffer;

/**
 * Encrypt notification content before it enters the FCM transport.
 *
 * AES-GCM authenticates both the ciphertext and protocol version. A fresh
 * PBKDF2 salt and GCM IV are generated for every message, so repeated content
 * never produces a repeated payload even when the join code is unchanged.
 */
export function encryptNotification(
  joinCode: BinaryLike,
  content: PushNotificationInput,
  random: RandomBytes = randomBytes,
): EncryptedNotification {
  const plaintext = Buffer.from(JSON.stringify(content), "utf8");
  if (plaintext.length > MAX_NOTIFICATION_PLAINTEXT_BYTES) {
    throw new RangeError("Notification content is too large for FCM");
  }
  const salt = random(NOTIFICATION_SALT_BYTES);
  const iv = random(NOTIFICATION_IV_BYTES);
  const key = pbkdf2Sync(
    joinCode,
    salt,
    NOTIFICATION_KEY_ITERATIONS,
    NOTIFICATION_KEY_BYTES,
    "sha256",
  );
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(NOTIFICATION_AAD, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    v: NOTIFICATION_ENCRYPTION_VERSION,
    salt: salt.toString("base64url"),
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

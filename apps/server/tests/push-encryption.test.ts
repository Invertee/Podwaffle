import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  encryptNotification,
  NOTIFICATION_AAD,
  NOTIFICATION_KEY_BYTES,
  NOTIFICATION_KEY_ITERATIONS,
  MAX_NOTIFICATION_PLAINTEXT_BYTES,
} from "../src/push/encryption.js";

describe("push notification encryption", () => {
  it("round-trips authenticated content without exposing plaintext", () => {
    const salt = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    const iv = Buffer.from("00112233445566778899aabb", "hex");
    const encrypted = encryptNotification(
      "correct horse battery staple",
      { title: "Front door", message: "Someone is at the door" },
      (size) => (size === salt.length ? salt : iv),
    );

    const encryptedJson = JSON.stringify(encrypted);
    expect(encryptedJson).not.toContain("Front door");
    expect(encryptedJson).not.toContain("Someone is at the door");

    const decodedSalt = Buffer.from(encrypted.salt, "base64url");
    const decodedIv = Buffer.from(encrypted.iv, "base64url");
    const combined = Buffer.from(encrypted.ciphertext, "base64url");
    const tag = combined.subarray(combined.length - 16);
    const ciphertext = combined.subarray(0, combined.length - 16);
    const key = pbkdf2Sync(
      "correct horse battery staple",
      decodedSalt,
      NOTIFICATION_KEY_ITERATIONS,
      NOTIFICATION_KEY_BYTES,
      "sha256",
    );
    const decipher = createDecipheriv("aes-256-gcm", key, decodedIv);
    decipher.setAAD(Buffer.from(NOTIFICATION_AAD, "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");

    expect(JSON.parse(plaintext)).toEqual({
      title: "Front door",
      message: "Someone is at the door",
    });
  });

  it("rejects the wrong join code", () => {
    const encrypted = encryptNotification("right-code", {
      title: "Podwaffle",
      message: "Private message",
    });
    const salt = Buffer.from(encrypted.salt, "base64url");
    const iv = Buffer.from(encrypted.iv, "base64url");
    const combined = Buffer.from(encrypted.ciphertext, "base64url");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      pbkdf2Sync(
        "wrong-code",
        salt,
        NOTIFICATION_KEY_ITERATIONS,
        NOTIFICATION_KEY_BYTES,
        "sha256",
      ),
      iv,
    );
    decipher.setAAD(Buffer.from(NOTIFICATION_AAD, "utf8"));
    decipher.setAuthTag(combined.subarray(combined.length - 16));
    decipher.update(combined.subarray(0, combined.length - 16));

    expect(() => decipher.final()).toThrow();
  });

  it("rejects content that cannot fit in an FCM data message", () => {
    expect(() =>
      encryptNotification("right-code", {
        title: "Podwaffle",
        message: "🔒".repeat(MAX_NOTIFICATION_PLAINTEXT_BYTES),
      }),
    ).toThrow("too large for FCM");
  });
});

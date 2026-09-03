import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  clearPushDiagnostics,
  pushErrorMessage,
  readPushDiagnostics,
  recordPushDiagnostic,
  subscribePushDiagnostics,
} from "./pushDiagnostics";

jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual(
    "@react-native-async-storage/async-storage/jest/async-storage-mock",
  ),
);

beforeEach(async () => {
  await AsyncStorage.clear();
  await clearPushDiagnostics();
});

describe("push diagnostics", () => {
  it("stores newest entries first and publishes updates", async () => {
    const listener = jest.fn();
    const unsubscribe = subscribePushDiagnostics(listener);

    await recordPushDiagnostic("push.register.started", { enabled: true });
    await recordPushDiagnostic(
      "push.notification.decrypt.failed",
      "bad authentication tag",
      "error",
    );

    expect(await readPushDiagnostics()).toEqual([
      expect.objectContaining({
        level: "error",
        event: "push.notification.decrypt.failed",
        detail: "bad authentication tag",
      }),
      expect.objectContaining({
        level: "info",
        event: "push.register.started",
        detail: '{"enabled":true}',
      }),
    ]);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("clears persisted entries", async () => {
    await recordPushDiagnostic("push.test");
    await clearPushDiagnostics();
    expect(await readPushDiagnostics()).toEqual([]);
  });

  it("formats native errors without exposing object internals", () => {
    const error = new TypeError("Notification permission denied");
    expect(pushErrorMessage(error)).toBe(
      "TypeError: Notification permission denied",
    );
    expect(pushErrorMessage("failed")).toBe("failed");
  });
});

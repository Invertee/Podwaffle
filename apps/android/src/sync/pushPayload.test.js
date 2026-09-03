import { asPushData, isVisibleLocalNotification } from "./pushPayload";

describe("push payload visibility", () => {
  it.each(["playback-command", "sync", undefined])(
    "keeps %s FCM messages silent",
    (kind) => {
      expect(isVisibleLocalNotification(kind ? { kind } : {})).toBe(false);
    },
  );

  it("shows only the local notification created after decryption", () => {
    expect(
      isVisibleLocalNotification({ kind: "podwaffle-local-notification" }),
    ).toBe(true);
  });

  it("normalizes Android's nested foreground payload", () => {
    expect(asPushData({ data: { kind: "sync", revision: "3" } })).toEqual({
      kind: "sync",
      revision: "3",
    });
  });

  it("unwraps Expo's background task dataString payload", () => {
    const encrypted = {
      kind: "notification",
      v: "1",
      salt: "salt",
      iv: "iv",
      ciphertext: "ciphertext",
    };
    expect(
      asPushData({
        data: { dataString: JSON.stringify(encrypted) },
        notification: null,
      }),
    ).toEqual(encrypted);
  });

  it("accepts a direct dataString envelope without throwing", () => {
    expect(
      asPushData({ dataString: JSON.stringify({ kind: "sync", revision: "4" }) }),
    ).toEqual({ kind: "sync", revision: "4" });
    expect(asPushData({ dataString: "not-json" })).toEqual({
      dataString: "not-json",
    });
  });
});

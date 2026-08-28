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

  it("normalizes Android's nested task payload", () => {
    expect(asPushData({ data: { kind: "sync", revision: "3" } })).toEqual({
      kind: "sync",
      revision: "3",
    });
  });
});

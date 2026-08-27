import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PodwaffleWebSocketServer } from "../src/websocket/server.js";

describe("playback command delivery", () => {
  it("counts an accepted FCM wake-up when the target has no live socket", async () => {
    const wakePlaybackDevice = vi.fn().mockResolvedValue(true);
    const relay = new PodwaffleWebSocketServer({} as never, {} as never, {
      wakePlaybackDevice,
    });
    const commandId = randomUUID();
    const ownerDeviceId = randomUUID();

    await expect(
      relay.sendPlaybackCommand(randomUUID(), ownerDeviceId, {
        commandId,
        action: "pause",
        requestedByDeviceId: randomUUID(),
      }),
    ).resolves.toBe(true);
    expect(wakePlaybackDevice).toHaveBeenCalledWith(ownerDeviceId, commandId);
  });

  it("reports an unavailable target when FCM cannot queue the wake-up", async () => {
    const relay = new PodwaffleWebSocketServer({} as never, {} as never, {
      wakePlaybackDevice: vi.fn().mockResolvedValue(false),
    });

    await expect(
      relay.sendPlaybackCommand(randomUUID(), randomUUID(), {
        commandId: randomUUID(),
        action: "play",
        requestedByDeviceId: randomUUID(),
      }),
    ).resolves.toBe(false);
  });
});

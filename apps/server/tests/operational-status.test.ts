import { describe, expect, it } from "vitest";

import {
  formatOperationalSummary,
  type OperationalSnapshot,
} from "../src/operational-status.js";

describe("human-readable operational status", () => {
  it("summarizes app types, connection methods and playback", () => {
    const snapshot: OperationalSnapshot = {
      apps: [
        { id: "android", name: "Sam's phone", platform: "android" },
        { id: "browser", name: "Chrome", platform: "web" },
        {
          id: "home-assistant",
          name: "Home Assistant",
          platform: "home_assistant",
        },
      ],
      liveDeviceIds: ["android", "browser"],
      playback: [
        {
          profile: "Sam",
          state: "playing",
          mode: "local",
          episode: "A readable episode title",
          podcast: "The Example Podcast",
          device: "Sam's phone",
          positionMs: 754_000,
          durationMs: 2_700_000,
        },
      ],
      push: {
        enabled: true,
        projectId: "example-project",
        androidAppId: "example-app",
        registrations: 1,
      },
    };

    expect(formatOperationalSummary(snapshot)).toBe(
      "3 apps active in the last 2 minutes (1 Android, 1 web, 1 Home Assistant); 2 live-sync connections, 1 API-only connection. Sam is playing: “A readable episode title” from The Example Podcast on Sam's phone at 12:34 / 45:00.",
    );
  });

  it("reports an idle server plainly", () => {
    expect(
      formatOperationalSummary({
        apps: [],
        liveDeviceIds: [],
        playback: [
          {
            profile: "Sam",
            state: "stopped",
            mode: "local",
            episode: null,
            podcast: null,
            device: null,
            positionMs: 0,
            durationMs: null,
          },
        ],
        push: {
          enabled: false,
          projectId: null,
          androidAppId: null,
          registrations: 0,
        },
      }),
    ).toBe(
      "No apps active in the last 2 minutes. Sam is idle.",
    );
  });
});

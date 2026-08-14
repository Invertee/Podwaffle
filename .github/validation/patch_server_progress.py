from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:80]!r}")
    file.write_text(text.replace(old, new, 1))


playback = "apps/server/src/api/playback.ts"
marker = '''function leaseError(error: unknown): never {
  if (error instanceof Error && error.message === "PLAYBACK_LEASE_REQUIRED")
    throw new ApiError(
      409,
      "PLAYBACK_LEASE_REQUIRED",
      "This device does not hold the active playback lease",
    );
  throw error;
}
'''
helper = marker + '''
const DEFAULT_SKIP_BACKWARD_MS = 15_000;
const PROGRESS_REPORT_JITTER_MS = 5_000;

function guardedPlaybackPosition(
  db: PodwaffleDatabase["db"],
  profileId: string,
  episodeId: string | undefined,
  requestedPositionMs: number,
): number {
  if (!episodeId) return requestedPositionMs;
  const episodeState = db
    .prepare(
      `SELECT position_ms, played, updated_at
       FROM episode_state
       WHERE profile_id = ? AND episode_id = ?`,
    )
    .get(profileId, episodeId) as
    | { position_ms: number; played: number; updated_at: string }
    | undefined;
  if (
    !episodeState ||
    episodeState.played === 1 ||
    requestedPositionMs >= episodeState.position_ms
  ) {
    return requestedPositionMs;
  }

  let skipBackwardMs = DEFAULT_SKIP_BACKWARD_MS;
  const profile = db
    .prepare("SELECT settings_json FROM profiles WHERE id = ?")
    .get(profileId) as { settings_json: string } | undefined;
  if (profile) {
    try {
      const settings = JSON.parse(profile.settings_json) as {
        playback?: { skipBackwardSeconds?: unknown };
      };
      const seconds = Number(settings.playback?.skipBackwardSeconds);
      if (Number.isFinite(seconds)) {
        skipBackwardMs = Math.max(
          1_000,
          Math.min(120_000, Math.round(seconds * 1_000)),
        );
      }
    } catch {
      // Invalid legacy settings fall back to the default skip interval.
    }
  }

  if (
    episodeState.position_ms - requestedPositionMs <=
    skipBackwardMs + PROGRESS_REPORT_JITTER_MS
  ) {
    return requestedPositionMs;
  }

  const explicitBackwardMovement = db
    .prepare(
      `SELECT 1
       FROM movement_events
       WHERE profile_id = ?
         AND episode_id = ?
         AND type IN ('seek', 'skip-backward')
         AND confirmed_position_ms < from_position_ms
         AND occurred_at >= ?
         AND confirmed_position_ms <= ?
         AND from_position_ms >= ?
       ORDER BY occurred_at DESC
       LIMIT 1`,
    )
    .get(
      profileId,
      episodeId,
      episodeState.updated_at,
      requestedPositionMs,
      requestedPositionMs,
    );
  return explicitBackwardMovement
    ? requestedPositionMs
    : episodeState.position_ms;
}
'''
replace_once(playback, marker, helper)
replace_once(
    playback,
    "            acquireLease(db, profile.id, device.id, input);\n",
    '''            const guardedInput = {
              ...input,
              positionMs: guardedPlaybackPosition(
                db,
                profile.id,
                input.episodeId,
                input.positionMs,
              ),
            };
            acquireLease(db, profile.id, device.id, guardedInput);
''',
)
stale_block = '''            const staleCompletedReport = Boolean(
              priorEpisode?.played &&
              currentPlayback.episode?.id !== input.episodeId,
            );

'''
replace_once(
    playback,
    stale_block,
    stale_block + '''            const guardedInput = {
              ...input,
              positionMs: guardedPlaybackPosition(
                db,
                profile.id,
                input.episodeId,
                input.positionMs,
              ),
            };

''',
)
replace_once(
    playback,
    "                updatePlayback(db, profile.id, device.id, input);\n",
    "                updatePlayback(db, profile.id, device.id, guardedInput);\n",
)
replace_once(
    playback,
    "                  input.positionMs,\n                  input.durationMs,\n",
    "                  guardedInput.positionMs,\n                  guardedInput.durationMs,\n",
)
replace_once(
    playback,
    "            // completed queue item after exact-end processing advanced playback.\n",
    '''            // completed queue item after exact-end processing advanced playback.
            // Large unexplained backwards reports are also clamped to the saved
            // episode position; explicit seek/skip events still permit rewinds.
''',
)

Path("apps/server/tests/integration/playback-progress-regression.test.ts").write_text('''import { randomUUID } from "node:crypto";
import supertest from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import type { Runtime } from "../../src/runtime.js";
import { join, testRuntime } from "../helpers.js";

const runtimes: Runtime[] = [];

afterEach(async () => {
  while (runtimes.length) await runtimes.pop()?.close();
});

describe("playback progress regression guard", () => {
  it("rejects stale large rewinds but allows normal skip-back and explicit seeks", async () => {
    const created = await testRuntime();
    runtimes.push(created.runtime);
    const client = supertest.agent(created.baseUrl);
    await join(client);

    const now = new Date().toISOString();
    const podcastId = randomUUID();
    const episodeId = randomUUID();
    created.runtime.database.db
      .prepare(
        `INSERT INTO podcasts(
          id, feed_url, title, failure_count, created_at, updated_at
        ) VALUES (?, ?, ?, 0, ?, ?)`,
      )
      .run(
        podcastId,
        "https://example.test/progress-regression-feed",
        "Progress regression show",
        now,
        now,
      );
    created.runtime.database.db
      .prepare(
        `INSERT INTO episodes(
          id, podcast_id, guid, enclosure_url, title, first_discovered_at,
          duration_ms, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        episodeId,
        podcastId,
        "progress-regression-episode",
        "https://example.test/progress-regression.mp3",
        "Regression episode",
        now,
        3_600_000,
        now,
        now,
      );

    await client.post("/api/v1/playback/lease").send({
      episodeId,
      positionMs: 0,
      durationMs: 3_600_000,
      playbackRate: 1,
    }).expect(200);

    const progressed = await client.post("/api/v1/playback/state").send({
      episodeId,
      positionMs: 1_800_000,
      durationMs: 3_600_000,
      state: "paused",
      playbackRate: 1,
    }).expect(200);
    expect(progressed.body.episode.positionMs).toBe(1_800_000);

    const staleLease = await client.post("/api/v1/playback/lease").send({
      episodeId,
      positionMs: 0,
      durationMs: 3_600_000,
      playbackRate: 1,
    }).expect(200);
    expect(staleLease.body.playback.positionMs).toBe(1_800_000);

    const staleState = await client.post("/api/v1/playback/state").send({
      episodeId,
      positionMs: 0,
      durationMs: 3_600_000,
      state: "paused",
      playbackRate: 1,
    }).expect(200);
    expect(staleState.body.playback.positionMs).toBe(1_800_000);
    expect(staleState.body.episode.positionMs).toBe(1_800_000);

    const normalSkipBack = await client.post("/api/v1/playback/state").send({
      episodeId,
      positionMs: 1_786_000,
      durationMs: 3_600_000,
      state: "paused",
      playbackRate: 1,
    }).expect(200);
    expect(normalSkipBack.body.episode.positionMs).toBe(1_786_000);

    await client.post("/api/v1/playback/state").send({
      episodeId,
      positionMs: 1_800_000,
      durationMs: 3_600_000,
      state: "paused",
      playbackRate: 1,
    }).expect(200);

    await client.post("/api/v1/playback/movements").send({
      commandId: randomUUID(),
      episodeId,
      type: "seek",
      fromPositionMs: 1_800_000,
      requestedPositionMs: 600_000,
      confirmedPositionMs: 600_000,
    }).expect(201);

    const explicitRewind = await client.post("/api/v1/playback/state").send({
      episodeId,
      positionMs: 600_000,
      durationMs: 3_600_000,
      state: "paused",
      playbackRate: 1,
    }).expect(200);
    expect(explicitRewind.body.playback.positionMs).toBe(600_000);
    expect(explicitRewind.body.episode.positionMs).toBe(600_000);
  });
});
''')

path = Path("apps/server/tests/integration/database.test.ts")
text = path.read_text()
if text.count("toBe(5)") != 4:
    raise SystemExit(f"Expected four stale schema 5 assertions, found {text.count('toBe(5)')}")
path.write_text(text.replace("toBe(5)", "toBe(6)"))

from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:80]!r}")
    file.write_text(text.replace(old, new, 1))


offline = "apps/android/src/playback/offlineProgress.ts"
replace_once(
    offline,
    '''  completed: boolean;\n  updatedAt: string;\n''',
    '''  completed: boolean;\n  allowRegression?: boolean;\n  updatedAt: string;\n''',
)
replace_once(
    offline,
    '''    current.completed === expected.completed &&\n    current.updatedAt === expected.updatedAt\n''',
    '''    current.completed === expected.completed &&\n    current.allowRegression === expected.allowRegression &&\n    current.updatedAt === expected.updatedAt\n''',
)
replace_once(
    offline,
    '''    const completed = update.completed || prior?.completed === true;\n    const next: PendingPlaybackUpdate = {\n      ...update,\n      positionMs: Math.max(update.positionMs, prior?.positionMs ?? 0),\n      durationMs: update.durationMs ?? prior?.durationMs ?? null,\n      state: completed ? "stopped" : update.state,\n      completed,\n      updatedAt: new Date().toISOString(),\n    };\n''',
    '''    const completed = update.completed || prior?.completed === true;\n    const allowRegression =\n      !completed &&\n      (update.allowRegression === true || prior?.allowRegression === true);\n    const next: PendingPlaybackUpdate = {\n      ...update,\n      positionMs: allowRegression\n        ? update.positionMs\n        : Math.max(update.positionMs, prior?.positionMs ?? 0),\n      durationMs: update.durationMs ?? prior?.durationMs ?? null,\n      state: completed ? "stopped" : update.state,\n      completed,\n      ...(allowRegression ? { allowRegression: true } : {}),\n      updatedAt: new Date().toISOString(),\n    };\n''',
)

Path("apps/android/src/playback/progressReconciliation.ts").write_text('''import type { Episode } from "@podwaffle/contracts";

import type { PendingPlaybackUpdate } from "./offlineProgress";

export const PROGRESS_RECONCILIATION_TOLERANCE_MS = 5_000;

export function resumePositionMs(
  savedPositionMs: number,
  nativePositionMs: number,
): number {
  const saved = Math.max(0, savedPositionMs);
  const native = Math.max(0, nativePositionMs);
  return saved - native > PROGRESS_RECONCILIATION_TOLERANCE_MS
    ? saved
    : native;
}

export function pendingProgressIsStale(
  update: PendingPlaybackUpdate,
  serverEpisode: Episode,
): boolean {
  if (update.completed || update.allowRegression === true) return false;
  if (serverEpisode.played) return true;
  return (
    serverEpisode.positionMs - update.positionMs >
    PROGRESS_RECONCILIATION_TOLERANCE_MS
  );
}
''')

Path("apps/android/src/playback/progressReconciliation.test.js").write_text('''import {
  pendingProgressIsStale,
  resumePositionMs,
} from "./progressReconciliation";

describe("progress reconciliation", () => {
  it("resumes a restored native player from materially newer saved progress", () => {
    expect(resumePositionMs(1_800_000, 0)).toBe(1_800_000);
    expect(resumePositionMs(1_800_000, 1_798_000)).toBe(1_798_000);
  });

  it("drops an older pending report but preserves an explicit offline rewind", () => {
    const serverEpisode = { played: false, positionMs: 1_800_000 };
    const stale = { completed: false, positionMs: 300_000 };
    expect(pendingProgressIsStale(stale, serverEpisode)).toBe(true);
    expect(
      pendingProgressIsStale(
        { ...stale, allowRegression: true },
        serverEpisode,
      ),
    ).toBe(false);
  });
});
''')

controller = "apps/android/src/playback/controller.ts"
replace_once(
    controller,
    '''import {\n  pendingCompletionEpisodeIds,\n  queueWithoutPendingCompletions,\n  staleCompletedQueueEpisodeIds,\n} from "./queueReconciliation";\n''',
    '''import {\n  pendingCompletionEpisodeIds,\n  queueWithoutPendingCompletions,\n  staleCompletedQueueEpisodeIds,\n} from "./queueReconciliation";\nimport {\n  pendingProgressIsStale,\n  resumePositionMs,\n} from "./progressReconciliation";\n''',
)
replace_once(
    controller,
    '''      this.activeEpisode = playbackEpisode;\n      this.completedEpisodeId = null;\n      await this.play();\n''',
    '''      this.activeEpisode = playbackEpisode;\n      this.completedEpisodeId = null;\n      const resumePosition = resumePositionMs(\n        playbackEpisode.positionMs,\n        current.positionMs,\n      );\n      if (resumePosition !== current.positionMs) {\n        await PodwaffleMediaModule.seekTo(resumePosition);\n      }\n      await this.play();\n''',
)
replace_once(
    controller,
    '''          } else {\n            if (await this.completionPending(update.episodeId)) continue;\n            const lease = await api.acquirePlayback(\n              credentials.serverUrl,\n              credentials.token,\n              {\n                episodeId: update.episodeId,\n                positionMs: update.positionMs,\n                durationMs: update.durationMs,\n                playbackRate: update.playbackRate,\n              },\n            );\n            this.setLeaseExpiry(lease.leaseExpiresAt);\n            if (await this.completionPending(update.episodeId)) continue;\n            await api.updatePlayback(credentials.serverUrl, credentials.token, {\n              episodeId: update.episodeId,\n              positionMs: update.positionMs,\n              durationMs: update.durationMs,\n              state: update.state,\n              playbackRate: update.playbackRate,\n            });\n          }\n''',
    '''          } else {\n            if (await this.completionPending(update.episodeId)) continue;\n            const serverEpisode = await api.episode(\n              credentials.serverUrl,\n              credentials.token,\n              update.episodeId,\n            );\n            if (pendingProgressIsStale(update, serverEpisode)) {\n              await acknowledgePendingPlayback(profileId, update);\n              continue;\n            }\n            const lease = await api.acquirePlayback(\n              credentials.serverUrl,\n              credentials.token,\n              {\n                episodeId: update.episodeId,\n                positionMs: update.positionMs,\n                durationMs: update.durationMs,\n                playbackRate: update.playbackRate,\n              },\n            );\n            this.setLeaseExpiry(lease.leaseExpiresAt);\n            if (await this.completionPending(update.episodeId)) continue;\n            if (\n              update.allowRegression === true &&\n              serverEpisode.positionMs > update.positionMs\n            ) {\n              await api.movement(credentials.serverUrl, credentials.token, {\n                commandId: createCommandId(),\n                episodeId: update.episodeId,\n                type: "seek",\n                fromPositionMs: serverEpisode.positionMs,\n                requestedPositionMs: update.positionMs,\n                confirmedPositionMs: update.positionMs,\n              });\n            }\n            await api.updatePlayback(credentials.serverUrl, credentials.token, {\n              episodeId: update.episodeId,\n              positionMs: update.positionMs,\n              durationMs: update.durationMs,\n              state: update.state,\n              playbackRate: update.playbackRate,\n            });\n          }\n''',
)
replace_once(
    controller,
    '''          await this.saveOfflinePlayback(\n            {\n              episodeId: state.episodeId!,\n              positionMs: requestedPositionMs,\n              durationMs,\n              state: localPlaybackState(state),\n              playbackRate: state.playbackRate,\n            },\n            false,\n          );\n''',
    '''          await this.saveOfflinePlayback(\n            {\n              episodeId: state.episodeId!,\n              positionMs: requestedPositionMs,\n              durationMs,\n              state: localPlaybackState(state),\n              playbackRate: state.playbackRate,\n            },\n            false,\n            requestedPositionMs < state.positionMs,\n          );\n''',
)
replace_once(
    controller,
    '''    completed: boolean,\n  ): Promise<PendingPlaybackUpdate | null> {\n''',
    '''    completed: boolean,\n    allowRegression = false,\n  ): Promise<PendingPlaybackUpdate | null> {\n''',
)
replace_once(
    controller,
    '''    return savePendingPlayback(profileId, { ...body, completed });\n''',
    '''    return savePendingPlayback(profileId, {\n      ...body,\n      completed,\n      allowRegression,\n    });\n''',
)

offline_test = Path("apps/android/src/playback/offlineProgress.test.js")
text = offline_test.read_text()
insert = '''
  it("preserves an explicit offline rewind instead of merging it forward", async () => {
    await savePendingPlayback(profileId, {
      episodeId,
      positionMs: 50_000,
      durationMs: 60_000,
      state: "paused",
      playbackRate: 1,
      completed: false,
    });
    await savePendingPlayback(profileId, {
      episodeId,
      positionMs: 20_000,
      durationMs: 60_000,
      state: "paused",
      playbackRate: 1,
      completed: false,
      allowRegression: true,
    });

    expect(await pendingPlaybackUpdates(profileId)).toEqual([
      expect.objectContaining({
        episodeId,
        positionMs: 20_000,
        allowRegression: true,
      }),
    ]);
  });
'''
if insert.strip() not in text:
    pos = text.rfind("\n});")
    if pos < 0:
        raise SystemExit("Could not extend offlineProgress.test.js")
    offline_test.write_text(text[:pos] + insert + text[pos:])

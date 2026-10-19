import { playbackController } from "../playback/controller";
import { useAuthStore } from "../stores/auth";
import { downloadAnalysedEpisodes } from "./analysisDownloads";
import { pushErrorMessage, recordPushDiagnostic } from "./pushDiagnostics";
import { syncRuntime } from "./runtime";

export async function synchronizeFromPush(kind: unknown): Promise<void> {
  const initial = useAuthStore.getState();
  if (initial.status === "restoring") await initial.restore();
  const current = useAuthStore.getState();
  if (current.status !== "authenticated" || !current.credentials) {
    await recordPushDiagnostic(
      "push.sync.skipped_not_authenticated",
      { status: current.status },
      "warning",
    ).catch(() => undefined);
    return;
  }
  const attempt = async (event: string, operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch (error) {
      await recordPushDiagnostic(
        event,
        pushErrorMessage(error),
        "warning",
      ).catch(() => undefined);
    }
  };
  const downloads = () =>
    attempt("push.analysis_downloads.failed", downloadAnalysedEpisodes);
  // Hand durable download work to Android immediately. Unrelated playback or
  // snapshot requests must not consume the analysis wake-up or block downloads.
  if (kind === "analysis-ready") await downloads();
  await attempt("push.playback_commands.failed", () =>
    syncRuntime.processPendingCommands(),
  );
  await attempt("push.refresh.failed", () => current.refresh());
  if (kind !== "analysis-ready") await downloads();
  await attempt("push.playback_flush.failed", () =>
    playbackController.flushPendingPlayback(),
  );
}

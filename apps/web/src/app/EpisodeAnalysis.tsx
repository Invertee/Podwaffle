import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  stripHtml,
  type Episode,
  type AnalysisSettings,
} from "@podwaffle/contracts";
import { api } from "../api/client";
import { player, usePlayer } from "../player/local-player";
import "../styles/analysis.css";

function timestamp(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function PodcastAnalysisSettings({ podcastId }: { podcastId: string }) {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["analysis-settings", podcastId],
    queryFn: () => api.analysisSettings(podcastId),
  });
  const [draft, setDraft] = useState<AnalysisSettings | null>(null);
  const [phrases, setPhrases] = useState("");
  const save = useMutation({
    mutationFn: () =>
      api.saveAnalysisSettings(podcastId, {
        enabled: draft?.enabled ?? settings.data?.settings.enabled ?? false,
        phrases: draft
          ? phrases
              .split("\n")
              .map((p) => p.trim())
              .filter(Boolean)
          : (settings.data?.settings.phrases ?? []),
      }),
    onSuccess: async () => {
      setDraft(null);
      await queryClient.invalidateQueries({
        queryKey: ["analysis-settings", podcastId],
      });
    },
  });
  const value = draft ?? settings.data?.settings;
  return (
    <details className="analysis-settings">
      <summary>
        Chapters & advert analysis{" "}
        <span>{settings.data?.settings.enabled ? "Enabled" : "Off"}</span>
      </summary>
      {settings.isLoading ? (
        <p>Loading settings…</p>
      ) : settings.error ? (
        <p role="alert">{settings.error.message}</p>
      ) : (
        value && (
          <>
            {!settings.data?.configured && (
              <p className="analysis-notice">
                Set <code>analysis_server_url</code> in the server options to
                connect your local analyser.
              </p>
            )}
            <p>
              Analyse newly discovered episodes for this profile. English only.
              All seeking is manual while detection is being tested.
            </p>
            <label>
              <input
                type="checkbox"
                checked={value.enabled}
                disabled={save.isPending}
                onChange={(event) => {
                  setDraft({ ...value, enabled: event.target.checked });
                  if (!draft) setPhrases(value.phrases.join("\n"));
                }}
              />{" "}
              Analyse new episodes
            </label>
            <label className="analysis-field">
              Sponsor names and phrases (one per line, up to 50)
              <textarea
                value={draft ? phrases : value.phrases.join("\n")}
                rows={4}
                disabled={save.isPending}
                placeholder={"our sponsor\npromo code\nA sponsor name"}
                onChange={(event) => {
                  setDraft(value);
                  setPhrases(event.target.value);
                }}
              />
            </label>
            <p>
              Phrases flag matching speech for review. Saving does not reprocess
              older episodes; use the episode diagnostics to run analysis on
              demand.
            </p>
            <button
              disabled={!draft || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : "Save analysis settings"}
            </button>
            {save.error && <p role="alert">{save.error.message}</p>}
            {save.isSuccess && !draft && <p role="status">Settings saved.</p>}
          </>
        )
      )}
    </details>
  );
}

export function EpisodeAnalysisButton({ episode }: { episode: Episode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="text-button"
        onClick={() => setOpen(true)}
        aria-label={`Details and chapters for ${episode.title}`}
      >
        Details & chapters
      </button>
      {open && (
        <EpisodeAnalysisModal episode={episode} close={() => setOpen(false)} />
      )}
    </>
  );
}

function EpisodeAnalysisModal({
  episode,
  close,
}: {
  episode: Episode;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const queryClient = useQueryClient();
  const analysis = useQuery({
    queryKey: ["episode-analysis", episode.id],
    queryFn: () => api.episodeAnalysis(episode.id),
    refetchInterval: (query) =>
      !query.state.data ||
      ["queued", "processing"].includes(query.state.data.job?.status ?? "")
        ? 5000
        : false,
  });
  const run = useMutation({
    mutationFn: () => api.analyseEpisode(episode.id),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["episode-analysis", episode.id],
      }),
  });
  const currentEpisode = usePlayer((state) => state.episode?.id);
  const [actionError, setActionError] = useState<string | null>(null);
  const [seeking, setSeeking] = useState(false);
  const job = analysis.data?.job,
    result = job?.result;
  const active = job && ["queued", "processing"].includes(job.status);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  async function seek(ms: number) {
    setSeeking(true);
    setActionError(null);
    try {
      await player.seek(ms);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Seek failed");
    } finally {
      setSeeking(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="analysis-modal"
      aria-labelledby={`analysis-title-${episode.id}`}
      onCancel={close}
    >
      <div className="analysis-modal-header">
        <div>
          <p className="eyebrow">{episode.podcastTitle}</p>
          <h2 id={`analysis-title-${episode.id}`}>{episode.title}</h2>
        </div>
        <button onClick={close} aria-label="Close episode details">
          Close
        </button>
      </div>
      <p className="episode-description">
        {stripHtml(episode.descriptionHtml)}
      </p>
      <h3>Chapters & suggested adverts</h3>
      <p className="analysis-notice">
        Experimental · No automatic skipping. Suggested times may differ from
        the version you hear, especially with dynamically inserted adverts.
      </p>
      {analysis.isLoading && <p>Loading analysis…</p>}
      {analysis.error && <p role="alert">{analysis.error.message}</p>}
      {job ? (
        <p role="status">
          {job.status} · {job.stage} {active ? `(${job.progress}%)` : ""}
        </p>
      ) : (
        !analysis.isLoading && <p>This episode has not been analysed.</p>
      )}
      {job?.error && <p role="alert">{job.error}</p>}
      {job?.stale && (
        <p role="alert">
          The feed audio URL changed after analysis. These markers may refer to
          an older version.
        </p>
      )}
      {result && (
        <>
          <p>
            {result.provider === "rules"
              ? "Local phrase detector"
              : result.provider === "local"
                ? "Local Qwen classification"
                : "Gemini classification"}{" "}
            · {result.model} · {result.segments.length} markers
            {result.classifierModel && ` · ${result.classifierModel}`}
          </p>
          {result.segments.length === 0 && (
            <p>
              No markers found in the sampled audio. This does not mean the
              episode is advert-free.
            </p>
          )}
          <div className="analysis-segments">
            {result.segments.map((segment, i) => (
              <article key={i} className={`analysis-segment ${segment.kind}`}>
                <div>
                  <span className="analysis-kind">
                    {segment.kind} · {Math.round(segment.confidence * 100)}%
                    confidence
                  </span>
                  <h4>{segment.title}</h4>
                  <p>
                    {timestamp(segment.startMs)}–{timestamp(segment.endMs)} ·{" "}
                    {segment.source} · approximate
                  </p>
                  <p>{segment.evidence}</p>
                </div>
                <div>
                  <button
                    disabled={
                      currentEpisode !== episode.id || seeking || job?.stale
                    }
                    onClick={() => void seek(segment.startMs)}
                  >
                    Go to start
                  </button>
                  {segment.kind !== "chapter" && (
                    <button
                      disabled={
                        currentEpisode !== episode.id || seeking || job?.stale
                      }
                      onClick={() => void seek(segment.endMs)}
                    >
                      Go to end
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {currentEpisode !== episode.id && (
            <p>Play this episode first to use the marker seek controls.</p>
          )}
        </>
      )}
      {actionError && <p role="alert">{actionError}</p>}
      <details className="analysis-diagnostics">
        <summary>Analysis diagnostics & testing tools</summary>
        <p>
          Run an analysis using the saved podcast phrases. This downloads audio
          on your local analyser; Gemini receives transcript excerpts only when
          configured there.
        </p>
        <button
          disabled={
            Boolean(active) ||
            run.isPending ||
            !analysis.data?.configured ||
            !episode.enclosureUrl
          }
          onClick={() => run.mutate()}
        >
          {active
            ? "Analysis in progress…"
            : result
              ? "Reanalyse episode"
              : "Analyse this episode"}
        </button>{" "}
        <button
          onClick={() => void analysis.refetch()}
          disabled={analysis.isFetching}
        >
          Refresh diagnostics
        </button>
        {!analysis.data?.configured && (
          <p>
            Configure <code>analysis_server_url</code> on the Podwaffle server
            to enable analysis.
          </p>
        )}
        {run.error && <p role="alert">{run.error.message}</p>}
        {job && (
          <dl>
            <dt>Job</dt>
            <dd>{job.id}</dd>
            <dt>Analyser job</dt>
            <dd>{job.remoteJobId ?? "Not submitted"}</dd>
            <dt>Queued</dt>
            <dd>{new Date(job.createdAt).toLocaleString()}</dd>
            <dt>Consecutive connection failures</dt>
            <dd>{job.attempts}</dd>
            {active && (
              <>
                <dt>Next poll/retry</dt>
                <dd>{new Date(job.nextAttemptAt).toLocaleString()}</dd>
              </>
            )}
            <dt>Transcript retention</dt>
            <dd>
              {result?.transcriptExpired
                ? "Purged"
                : job.transcriptExpiresAt
                  ? `Expires ${new Date(job.transcriptExpiresAt).toLocaleString()}`
                  : "No transcript yet"}
            </dd>
          </dl>
        )}
        {result && (
          <>
            <h4>Detection warnings</h4>
            <ul>
              {result.diagnostics.warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
            <h4>Media fingerprint (diagnostic only)</h4>
            <pre>{JSON.stringify(result.fingerprint, null, 2)}</pre>
            <h4>Sample coverage</h4>
            <p>
              {result.diagnostics.sampleWindows
                .map((w) => `${timestamp(w.startMs)}–${timestamp(w.endMs)}`)
                .join(", ")}
            </p>
            <h4>Acoustic boundaries</h4>
            <p>
              {result.diagnostics.acousticBoundariesMs
                .map(timestamp)
                .join(", ") || "None detected"}
            </p>
            <h4>Transcript excerpts</h4>
            {result.transcriptExpired ? (
              <p>Transcript excerpts were purged after seven days.</p>
            ) : (
              result.fragments.map((fragment, i) => (
                <p key={i}>
                  <strong>
                    {timestamp(fragment.startMs)}–{timestamp(fragment.endMs)}
                  </strong>{" "}
                  {fragment.text}
                </p>
              ))
            )}
          </>
        )}
        <h4>Job log</h4>
        <pre>
          {job?.logs
            .map(
              (entry) => `${entry.createdAt} ${entry.level} ${entry.message}`,
            )
            .join("\n") || "No analyser log received yet."}
        </pre>
      </details>
    </dialog>
  );
}

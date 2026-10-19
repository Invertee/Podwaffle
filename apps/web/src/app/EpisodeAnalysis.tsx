import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  stripHtml,
  type Episode,
  type AnalysisSettings,
} from "@podwaffle/contracts";
import { api } from "../api/client";
import { player, usePlayer } from "../player/local-player";
import { Icon } from "./Icon";
import "../styles/analysis.css";

function timestamp(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function PodcastDownloadOptionsButton({
  podcastId,
  podcastTitle,
}: {
  podcastId: string;
  podcastTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const dialogId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="icon-button download-options-button"
        title="Download Options"
        aria-label={`Download Options for ${podcastTitle}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        onClick={(event) => {
          event.currentTarget.focus();
          setOpen(true);
        }}
      >
        <Icon name="download" />
      </button>
      {open && (
        <PodcastDownloadOptionsModal
          podcastId={podcastId}
          podcastTitle={podcastTitle}
          dialogId={dialogId}
          trigger={trigger}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}

function PodcastDownloadOptionsModal({
  podcastId,
  podcastTitle,
  dialogId,
  trigger,
  close,
}: {
  podcastId: string;
  podcastTitle: string;
  dialogId: string;
  trigger: RefObject<HTMLButtonElement | null>;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      trigger.current?.focus();
    };
  }, [trigger]);
  return (
    <dialog
      ref={dialog}
      id={dialogId}
      className="analysis-modal download-options-modal"
      aria-labelledby={`${dialogId}-title`}
      aria-describedby={`${dialogId}-podcast`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          close();
      }}
    >
      <div className="download-options-layout">
        <header className="download-options-header">
          <span className="download-options-icon">
            <Icon name="download" />
          </span>
          <div className="download-options-copy">
            <h2 id={`${dialogId}-title`} className="download-options-heading">
              Download Options
            </h2>
            <p id={`${dialogId}-podcast`} className="download-options-podcast">
              {podcastTitle}
            </p>
          </div>
          <button
            type="button"
            className="icon-button download-options-close"
            aria-label="Close Download Options"
            onClick={close}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="download-options-content">
          <PodcastAnalysisSettings podcastId={podcastId} />
        </div>
      </div>
    </dialog>
  );
}

function PodcastAnalysisSettings({ podcastId }: { podcastId: string }) {
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
        llmPrompt: draft?.llmPrompt ?? settings.data?.settings.llmPrompt ?? "",
        sensitivity:
          draft?.sensitivity ??
          settings.data?.settings.sensitivity ??
          "balanced",
        edgeFocusMinutes:
          draft?.edgeFocusMinutes ??
          settings.data?.settings.edgeFocusMinutes ??
          5,
      }),
    onSuccess: async () => {
      setDraft(null);
      await queryClient.invalidateQueries({
        queryKey: ["analysis-settings", podcastId],
      });
    },
  });
  const value = draft ?? settings.data?.settings;
  function editSettings(changes: Partial<AnalysisSettings>) {
    if (!value) return;
    if (!draft) setPhrases(value.phrases.join("\n"));
    setDraft({ ...value, ...changes });
  }
  return (
    <div className="analysis-settings">
      {settings.isLoading ? (
        <p>Loading settings…</p>
      ) : settings.error ? (
        <p role="alert">{settings.error.message}</p>
      ) : (
        value && (
          <>
            {!settings.data?.configured && (
              <p className="analysis-notice">
                Enable analysis in the server options.
              </p>
            )}
            <p>
              Analyse newly discovered episodes for this profile. English only.
              Checked recordings are retained and automatically downloaded to
              Android on Wi-Fi.
            </p>
            <label className="analysis-toggle">
              <input
                type="checkbox"
                checked={value.enabled}
                disabled={save.isPending}
                onChange={(event) =>
                  editSettings({ enabled: event.target.checked })
                }
              />{" "}
              Analyse and download new episodes
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
            <label className="analysis-field">
              Jev detection guidance (optional)
              <textarea
                value={value.llmPrompt}
                rows={4}
                maxLength={2000}
                disabled={save.isPending}
                placeholder="For example: Treat host-read promotions for the host's own paid products as adverts."
                onChange={(event) =>
                  editSettings({ llmPrompt: event.target.value })
                }
              />
              <small>
                Used by Jev when configured on the analyser. Describe
                show-specific advert patterns. Times stay within transcript
                excerpts.
              </small>
            </label>
            <label className="analysis-field">
              Detection sensitivity
              <select
                value={value.sensitivity}
                disabled={save.isPending}
                onChange={(event) =>
                  editSettings({
                    sensitivity: event.target
                      .value as AnalysisSettings["sensitivity"],
                  })
                }
              >
                <option value="low">Low — fewer, stronger suggestions</option>
                <option value="balanced">Balanced</option>
                <option value="high">High — more possible suggestions</option>
              </select>
            </label>
            <label className="analysis-field">
              Focus on the first and last minutes
              <input
                type="number"
                min={0}
                max={15}
                step={1}
                value={value.edgeFocusMinutes}
                disabled={save.isPending}
                onChange={(event) =>
                  editSettings({
                    edgeFocusMinutes: Math.max(
                      0,
                      Math.min(15, Math.round(Number(event.target.value))),
                    ),
                  })
                }
              />
              <small>
                Prioritises sampling in both edge regions within the existing
                audio budget. Set to 0 for normal whole-episode sampling.
              </small>
            </label>
            <p>
              Phrases flag matching speech for review. These settings are
              captured when a job is queued. Saving does not reprocess older
              episodes; use the episode diagnostics to run analysis on demand.
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
    </div>
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
  const isJevAnalysis =
    result?.provider === "jev" || Boolean(result?.diagnostics.classifierUsage);
  const classifierAssessments = result?.diagnostics.classifierAssessments ?? [],
    diagnosticSensitivity = result?.diagnostics.sensitivity ?? "balanced",
    minimumAdvertConfidence =
      result?.diagnostics.minimumAdvertConfidence ?? 0.55;
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
        Suggested regions apply to the checked recording. Android can skip
        adverts when enabled in Profile; publisher fallback plays without
        skipping.
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
                : result.provider === "jev"
                  ? "Jev classification via DigitalOcean"
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
          Run an analysis using the saved podcast detection settings. This
          downloads and transcribes audio on your Podwaffle server. When Jev is
          selected there, transcript excerpts, episode context and detection
          guidance are sent to DigitalOcean for classification.
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
          <p>Enable analysis in the Podwaffle server options.</p>
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
            {(result.provider === "local" || isJevAnalysis) && (
              <>
                <h4>{isJevAnalysis ? "Jev" : "Local classifier"} decisions</h4>
                <p>
                  {diagnosticSensitivity} sensitivity requires at least{" "}
                  {Math.round(minimumAdvertConfidence * 100)}% confidence for
                  advert and promotion markers.{" "}
                  {isJevAnalysis
                    ? "The notes summarise Jev's selected labels. Jev does not generate explanations."
                    : "The notes are concise decision rationales."}
                </p>
                {classifierAssessments.length === 0 && (
                  <p>
                    No per-excerpt decisions were retained. Reanalyse with the
                    integrated engine to generate them.
                  </p>
                )}
              </>
            )}
            {result.diagnostics.classifierUsage && (
              <p>
                Jev requests: {result.diagnostics.classifierUsage.requests} ·
                Input tokens:{" "}
                {result.diagnostics.classifierUsage.inputTokens ?? "unknown"}
                {Boolean(result.diagnostics.classifierReturnedModels?.length) &&
                  ` · Returned model: ${result.diagnostics.classifierReturnedModels?.join(", ")}`}
              </p>
            )}
            <h4>Transcript excerpts</h4>
            {result.transcriptExpired ? (
              <p>Transcript excerpts were purged after seven days.</p>
            ) : (
              result.fragments.map((fragment, i) => {
                const assessment = classifierAssessments.find(
                  (candidate) =>
                    candidate.startMs === fragment.startMs &&
                    candidate.endMs === fragment.endMs,
                );
                const belowThreshold =
                  assessment &&
                  ["advertisement", "promotion"].includes(assessment.verdict) &&
                  assessment.confidence < minimumAdvertConfidence;
                return (
                  <div className="analysis-transcript" key={i}>
                    <p>
                      <strong>
                        {timestamp(fragment.startMs)}–
                        {timestamp(fragment.endMs)}
                      </strong>{" "}
                      {fragment.text}
                    </p>
                    {assessment && (
                      <p className="analysis-assessment">
                        {isJevAnalysis ? "Jev" : "Classifier"} decision:{" "}
                        {assessment.verdict.replace("_", " ")} ·{" "}
                        {Math.round(assessment.confidence * 100)}% —{" "}
                        {assessment.reason}
                        {belowThreshold && " (below the sensitivity threshold)"}
                        {assessment.probabilities && (
                          <>
                            <br />
                            Label probabilities:{" "}
                            {Object.entries(assessment.probabilities)
                              .map(
                                ([label, probability]) =>
                                  `${label.replace("_", " ")} ${Math.round(probability * 100)}%`,
                              )
                              .join(" · ")}
                          </>
                        )}
                      </p>
                    )}
                  </div>
                );
              })
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

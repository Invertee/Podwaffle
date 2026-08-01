import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../app/Icon";
import { useSyncStore } from "../stores/sync";
import { PlaybackDevicePicker } from "./PlaybackDevicePicker";
import { player, usePlayer } from "./local-player";

function time(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function PlayerBar({
  onQueue,
  queueCount,
}: {
  onQueue: () => void;
  queueCount: number;
}) {
  const queryClient = useQueryClient();
  const state = usePlayer();
  const remotePlayback = useSyncStore((store) => store.snapshot?.playback ?? null);
  const [remotePositionMs, setRemotePositionMs] = useState<number | null>(null);
  const remoteClock = useRef({
    episodeId: "",
    lastPositionMs: 0,
    zeroSamples: 0,
  });
  const [info, setInfo] = useState(false);
  const [devicePickerOpen, setDevicePickerOpen] = useState(false);
  const episode = state.episode;
  const castBusy = [
    "connecting",
    "reconnecting",
    "loading",
    "stopping",
  ].includes(state.castStatus);
  useEffect(() => player.start(), []);

  useEffect(() => {
    if (
      !state.remote ||
      !remotePlayback?.episode ||
      remotePlayback.state === "stopped"
    ) {
      setRemotePositionMs(null);
      return;
    }

    const episodeId = remotePlayback.episode.id;
    const sameEpisode = remoteClock.current.episodeId === episodeId;
    let anchorPositionMs = remotePlayback.positionMs;
    if (
      sameEpisode &&
      anchorPositionMs === 0 &&
      remoteClock.current.lastPositionMs > 5_000
    ) {
      remoteClock.current.zeroSamples += 1;
      if (remoteClock.current.zeroSamples < 2) {
        anchorPositionMs = remoteClock.current.lastPositionMs;
      }
    } else {
      remoteClock.current.zeroSamples = 0;
    }

    remoteClock.current.episodeId = episodeId;
    remoteClock.current.lastPositionMs = anchorPositionMs;
    const startedAt = Date.now();
    const durationMs =
      remotePlayback.durationMs ?? remotePlayback.episode.durationMs ?? 0;

    const update = () => {
      const elapsedMs =
        remotePlayback.state === "playing"
          ? (Date.now() - startedAt) * remotePlayback.playbackRate
          : 0;
      const next = Math.max(
        0,
        Math.min(durationMs || Number.MAX_SAFE_INTEGER, anchorPositionMs + elapsedMs),
      );
      remoteClock.current.lastPositionMs = next;
      setRemotePositionMs(next);
    };

    update();
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [
    state.remote,
    remotePlayback?.episode?.id,
    remotePlayback?.positionMs,
    remotePlayback?.durationMs,
    remotePlayback?.state,
    remotePlayback?.playbackRate,
  ]);

  const displayDurationMs =
    state.remote && remotePlayback?.episode
      ? (remotePlayback.durationMs ?? remotePlayback.episode.durationMs ?? state.durationMs)
      : state.durationMs;
  const displayPositionMs =
    state.remote && remotePositionMs !== null
      ? remotePositionMs
      : state.positionMs;

  async function skipAndRefreshStats(
    seconds: number,
    type: "skip-forward" | "skip-backward",
  ): Promise<void> {
    await player.skip(seconds, type);
    await queryClient.invalidateQueries({ queryKey: ["stats"] });
  }

  return (
    <>
      <section
        className={`player-bar${episode ? "" : " is-idle"}`}
        aria-label={episode ? "Now playing" : "Podcast player, idle"}
      >
        <div className="player-now">
          {episode?.artworkUrl ? (
            <img src={episode.artworkUrl} alt="" />
          ) : (
            <div className="player-art">PW</div>
          )}
          <div className="player-title">
            <strong>{episode?.title ?? "Nothing playing"}</strong>
            <span>
              {state.remote
                ? `${episode?.podcastTitle ?? "Podcast"} · playing on another device`
                : episode?.podcastTitle ??
                  "Choose an episode to start listening"}
            </span>
          </div>
        </div>
        <div className="player-center">
          <div className="transport">
            <button
              className="transport-skip"
              aria-label={`Skip back ${state.skipBackwardSeconds} seconds`}
              title={`Skip back ${state.skipBackwardSeconds} seconds`}
              disabled={!episode}
              onClick={() =>
                void skipAndRefreshStats(
                  -state.skipBackwardSeconds,
                  "skip-backward",
                )
              }
            >
              <Icon name="previous" />
            </button>
            <button
              className="transport-play"
              aria-label={state.playing ? "Pause" : "Play"}
              title={state.playing ? "Pause" : "Play"}
              disabled={!episode}
              onClick={() => void player.toggle()}
            >
              {state.playing ? (
                <span className="pause-icon" />
              ) : (
                <Icon name="playSimple" />
              )}
            </button>
            <button
              className="transport-skip"
              aria-label={`Skip forward ${state.skipForwardSeconds} seconds`}
              title={`Skip forward ${state.skipForwardSeconds} seconds`}
              disabled={!episode}
              onClick={() =>
                void skipAndRefreshStats(
                  state.skipForwardSeconds,
                  "skip-forward",
                )
              }
            >
              <Icon name="next" />
            </button>
          </div>
          <div className="timeline">
            <span>{time(displayPositionMs)}</span>
            <input
              aria-label="Episode progress"
              type="range"
              min={0}
              max={Math.max(1, displayDurationMs)}
              value={Math.min(displayPositionMs, displayDurationMs || 1)}
              disabled={!episode}
              onChange={(event) => void player.seek(Number(event.target.value))}
            />
            <span>−{time(displayDurationMs - displayPositionMs)}</span>
          </div>
        </div>
        <div className="player-tools">
          {!state.remote && (
            <label className="volume-control">
              <Icon name={state.muted ? "mute" : "volume"} />
              <span className="visually-hidden">
                {state.mode === "cast" ? "Cast volume" : "Volume"}
              </span>
              <input
                className="volume"
                aria-label={state.mode === "cast" ? "Cast volume" : "Volume"}
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={state.volume}
                onChange={(event) => player.setVolume(Number(event.target.value))}
              />
            </label>
          )}
          {episode && (
            <button
              className="icon-button"
              aria-label="Choose playback device"
              title="Play on…"
              onClick={() => setDevicePickerOpen(true)}
            >
              <Icon name="device" />
            </button>
          )}
          {episode &&
            !state.remote &&
            state.mode === "local" &&
            state.castAvailable && (
              <button
                className="icon-button cast-button"
                aria-label="Cast to a speaker"
                title="Cast to a speaker"
                disabled={castBusy}
                onClick={() => void player.startCasting()}
              >
                <Icon name="cast" />
              </button>
            )}
          {state.mode === "cast" && !state.remote && (
            <div className="cast-controls" aria-busy={castBusy}>
              <span
                className="visually-hidden"
                role="status"
                aria-live="polite"
              >
                {castStatusLabel(state)}
              </span>
              {state.castDeviceName && (
                <>
                  <button
                    className="icon-button"
                    aria-label={state.muted ? "Unmute Cast" : "Mute Cast"}
                    title={state.muted ? "Unmute Cast" : "Mute Cast"}
                    disabled={castBusy}
                    onClick={() => player.setMuted(!state.muted)}
                  >
                    <Icon name={state.muted ? "mute" : "volume"} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Choose Cast speaker"
                    title="Choose Cast speaker"
                    disabled={castBusy}
                    onClick={() => void player.reselectCastDevice()}
                  >
                    <Icon name="cast" />
                  </button>
                </>
              )}
              <button
                className="icon-button"
                aria-label="Stop casting"
                title="Stop casting"
                disabled={state.castStatus === "stopping"}
                onClick={() => void player.stopCasting()}
              >
                <Icon name="stop" />
              </button>
            </div>
          )}
          <button
            className="icon-button"
            aria-label={`Open queue, ${queueCount} ${queueCount === 1 ? "episode" : "episodes"}`}
            title="Open queue"
            onClick={onQueue}
          >
            <Icon name="list" />
          </button>
          <button
            className="icon-button"
            aria-label="Episode information"
            title="Episode information"
            disabled={!episode}
            onClick={() => setInfo(true)}
          >
            <Icon name="info" />
          </button>
        </div>
      </section>
      <PlaybackDevicePicker
        open={devicePickerOpen}
        onClose={() => setDevicePickerOpen(false)}
      />
      {info && episode && (
        <div className="drawer-backdrop" onClick={() => setInfo(false)}>
          <aside
            className="queue-drawer episode-info"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="icon-button drawer-close"
              aria-label="Close episode information"
              onClick={() => setInfo(false)}
            >
              <Icon name="close" />
            </button>
            {episode.artworkUrl && <img src={episode.artworkUrl} alt="" />}
            <p className="eyebrow">{episode.podcastTitle}</p>
            <h2>{episode.title}</h2>
            <p>
              {episode.publishedAt
                ? new Date(episode.publishedAt).toLocaleDateString()
                : ""}{" "}
              · {time(displayDurationMs)}
            </p>
            <div className="show-notes">{notes(episode.descriptionHtml)}</div>
            {episode.episodeUrl && (
              <a href={episode.episodeUrl} target="_blank" rel="noreferrer">
                Open episode source
              </a>
            )}
          </aside>
        </div>
      )}
    </>
  );
}

function castStatusLabel(state: ReturnType<typeof usePlayer.getState>): string {
  const destination = state.castDeviceName ? ` on ${state.castDeviceName}` : "";
  if (state.castStatus === "connecting")
    return "Connecting to Cast and loading episode…";
  if (state.castStatus === "reconnecting")
    return "Reconnecting to the active Cast session…";
  if (state.castStatus === "loading") return `Loading episode${destination}…`;
  if (state.castStatus === "stopping") return "Stopping Cast…";
  if (state.castStatus === "error")
    return state.error ?? "Cast connection needs attention";
  if (state.buffering) return `Buffering${destination}…`;
  return `Casting${state.castDeviceName ? ` to ${state.castDeviceName}` : ""}`;
}

function notes(html: string | null): string {
  if (!html) return "No show notes supplied.";
  const document = new DOMParser().parseFromString(html, "text/html");
  return document.body.textContent?.trim() || "No show notes supplied.";
}

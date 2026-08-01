import type { Device } from "@podwaffle/contracts";
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import { Icon } from "../app/Icon";
import { player, usePlayer } from "./local-player";
import "../styles/device-picker.css";

export function PlaybackDevicePicker({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const state = usePlayer();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api
      .devices()
      .then((items) => {
        if (!cancelled) setDevices(items);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : "Devices could not be loaded.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const ordered = useMemo(
    () =>
      [...devices].sort((a, b) => {
        const rank = (device: Device) => {
          if (device.current) return 0;
          if (Date.now() - Date.parse(device.lastSeenAt) < 5 * 60_000) return 1;
          return 2;
        };
        return rank(a) - rank(b) || a.name.localeCompare(b.name);
      }),
    [devices],
  );

  if (!open) return null;

  async function choose(device: Device) {
    const episode = state.episode;
    if (!episode) return;
    const connected =
      device.current ||
      Date.now() - Date.parse(device.lastSeenAt) < 5 * 60_000;
    if (!connected) return;
    setBusyId(device.id);
    setError(null);
    try {
      if (device.current) {
        if (state.remote) await player.takeOverPlayback();
      } else {
        const result = await api.playbackCommand({
          commandId: crypto.randomUUID(),
          action: "play-episode",
          episodeId: episode.id,
          positionMs: state.positionMs,
          targetDeviceId: device.id,
        });
        if (result.status === "pending" && !result.delivered) {
          throw new Error(`${device.name} is not connected to live sync.`);
        }
      }
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Playback could not be moved.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function castHere() {
    setBusyId("cast");
    setError(null);
    try {
      await player.startCasting();
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Google Cast could not be started.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="device-picker-backdrop" onClick={onClose}>
      <section
        className="device-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="device-picker-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="device-picker-title">Play on…</h2>
            <p>Choose a connected Podwaffle client or a Cast destination.</p>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>

        {error && (
          <p className="device-picker-error" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p className="device-picker-loading">Loading devices…</p>
        ) : (
          <div className="device-picker-list">
            {state.episode &&
              !state.remote &&
              state.mode === "local" &&
              state.castAvailable && (
                <button
                  className="device-picker-row"
                  disabled={busyId !== null}
                  onClick={() => void castHere()}
                >
                  <span className="device-picker-icon">
                    <Icon name="cast" />
                  </span>
                  <span className="device-picker-copy">
                    <strong>Google Cast</strong>
                    <small>Choose a speaker or display</small>
                  </span>
                  <span className="device-picker-action">
                    {busyId === "cast" ? "Opening…" : "Choose"}
                  </span>
                </button>
              )}
            {ordered.map((device) => {
              const connected =
                device.current ||
                Date.now() - Date.parse(device.lastSeenAt) < 5 * 60_000;
              return (
                <button
                  key={device.id}
                  className={`device-picker-row${device.current ? " is-current" : ""}${connected ? "" : " is-offline"}`}
                  disabled={!connected || busyId !== null || !state.episode}
                  onClick={() => void choose(device)}
                >
                  <span className="device-picker-icon">
                    <Icon name="device" />
                  </span>
                  <span className="device-picker-copy">
                    <strong>{device.current ? "This browser" : device.name}</strong>
                    <small>
                      {connected
                        ? `${device.platform === "web" ? "Web" : "Android"} · connected`
                        : "Offline"}
                    </small>
                  </span>
                  <span className="device-picker-action">
                    {busyId === device.id
                      ? "Moving…"
                      : device.current && !state.remote
                        ? "Playing here"
                        : connected
                          ? "Move here"
                          : ""}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

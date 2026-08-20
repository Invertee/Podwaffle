import type { PlaybackCommand } from "@podwaffle/contracts";

import {
  registerPlaybackHandoffHandler,
  sendPlaybackCommandResult,
} from "../api/playback-channel";
import { api } from "../api/client";
import { player, usePlayer } from "./local-player";

export async function takeOverBrowserPlayback(input?: {
  episodeId?: string;
  positionMs?: number;
  playbackState?: "playing" | "paused";
}): Promise<void> {
  const shared = await api.playback();
  const episodeId = input?.episodeId ?? shared.episode?.id;
  if (!episodeId) throw new Error("There is no shared playback to move.");

  const episode =
    shared.episode?.id === episodeId
      ? shared.episode
      : await api.episode(episodeId);
  const positionMs = Math.max(
    0,
    input?.positionMs ??
      (shared.episode?.id === episodeId
        ? shared.positionMs
        : episode.positionMs),
  );
  const playbackState =
    input?.playbackState ?? (shared.state === "playing" ? "playing" : "paused");

  await api.acquirePlayback({
    episodeId,
    positionMs,
    durationMs: shared.durationMs ?? episode.durationMs,
    playbackRate: shared.playbackRate || usePlayer.getState().rate,
    takeover: true,
  });

  usePlayer.setState({
    remote: false,
    mode: "local",
    episode: { ...episode, positionMs },
    positionMs,
    durationMs: shared.durationMs ?? episode.durationMs ?? 0,
    rate: shared.playbackRate || usePlayer.getState().rate,
    playing: false,
    buffering: false,
    castDeviceName: null,
    castSessionId: null,
    castStatus: "idle",
    error: null,
  });

  await player.load(
    {
      ...episode,
      positionMs,
      durationMs: shared.durationMs ?? episode.durationMs,
    },
    playbackState === "playing",
  );
  if (playbackState === "paused") player.pause();
}

registerPlaybackHandoffHandler(async (command: PlaybackCommand) => {
  try {
    const takeover: {
      episodeId?: string;
      positionMs?: number;
      playbackState?: "playing" | "paused";
    } = {};
    if (command.episodeId !== undefined) takeover.episodeId = command.episodeId;
    if (command.positionMs !== undefined)
      takeover.positionMs = command.positionMs;
    if (command.playbackState !== undefined) {
      takeover.playbackState = command.playbackState;
    }
    await takeOverBrowserPlayback(takeover);
    sendPlaybackCommandResult({
      commandId: command.commandId,
      status: "accepted",
    });
  } catch (error) {
    sendPlaybackCommandResult({
      commandId: command.commandId,
      status: "rejected",
      message:
        error instanceof Error ? error.message : "Playback could not be moved.",
    });
  }
});

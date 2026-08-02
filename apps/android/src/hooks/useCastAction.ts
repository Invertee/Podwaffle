import { useCallback } from "react";

import { PodwaffleMediaModule } from "../native-media";
import { playbackController } from "../playback/controller";
import { useAuthStore } from "../stores/auth";
import { useNativeMediaStore } from "../stores/nativeMedia";
import { usePlayerUiStore } from "../stores/playerUi";

export function useCastAction() {
  const cast = useNativeMediaStore((state) => state.castState);
  const nativeEpisodeId = useNativeMediaStore(
    (state) => state.state?.episodeId ?? null,
  );
  const currentDeviceId = useAuthStore(
    (state) => state.session?.device.id ?? null,
  );
  const sharedEpisodeId = useAuthStore(
    (state) => state.snapshot?.playback?.episode?.id ?? null,
  );
  const activeDeviceId = useAuthStore(
    (state) => state.snapshot?.playback?.activeDeviceId ?? null,
  );
  const sharedState = useAuthStore(
    (state) => state.snapshot?.playback?.state ?? "stopped",
  );
  const castStatus = usePlayerUiStore((state) => state.castStatus);
  const setCastStatus = usePlayerUiStore((state) => state.setCastStatus);
  const remote = Boolean(
    sharedEpisodeId &&
      activeDeviceId &&
      currentDeviceId &&
      activeDeviceId !== currentDeviceId &&
      sharedState !== "stopped",
  );
  const hasMedia = remote ? Boolean(sharedEpisodeId) : Boolean(nativeEpisodeId);

  const toggleCast = useCallback(async () => {
    if (remote) {
      throw new Error("Move playback to this device before starting Cast.");
    }
    if (cast.connected) {
      await playbackController.stopCasting(true);
      return;
    }
    if (hasMedia) {
      await playbackController.startCasting();
      return;
    }

    setCastStatus("connecting");
    try {
      const state = await PodwaffleMediaModule.showCastPicker();
      playbackController.handleCastState(state);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The Cast picker could not be opened.";
      setCastStatus("error", message);
      throw error;
    }
  }, [cast.connected, hasMedia, remote, setCastStatus]);

  return {
    cast,
    castStatus,
    toggleCast,
  };
}

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
  const sharedEpisodeId = useAuthStore(
    (state) => state.snapshot?.playback?.episode?.id ?? null,
  );
  const castStatus = usePlayerUiStore((state) => state.castStatus);
  const setCastStatus = usePlayerUiStore((state) => state.setCastStatus);
  const hasMedia = Boolean(sharedEpisodeId || nativeEpisodeId);

  const toggleCast = useCallback(async () => {
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
        error instanceof Error
          ? error.message
          : "The Cast picker could not be opened.";
      setCastStatus("error", message);
      throw error;
    }
  }, [cast.connected, hasMedia, setCastStatus]);

  return {
    cast,
    castStatus,
    toggleCast,
  };
}

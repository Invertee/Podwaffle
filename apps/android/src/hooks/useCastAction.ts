import { useCallback } from "react";

import { PodwaffleMediaModule } from "../native-media";
import { playbackController } from "../playback/controller";
import { usePlaybackPresentation } from "../playback/presentation";
import { useNativeMediaStore } from "../stores/nativeMedia";
import { usePlayerUiStore } from "../stores/playerUi";

export function useCastAction() {
  const presentation = usePlaybackPresentation();
  const cast = useNativeMediaStore((state) => state.castState);
  const castStatus = usePlayerUiStore((state) => state.castStatus);
  const setCastStatus = usePlayerUiStore((state) => state.setCastStatus);

  const toggleCast = useCallback(async () => {
    if (presentation.remote) {
      throw new Error("Move playback to this device before starting Cast.");
    }
    if (cast.connected) {
      await playbackController.stopCasting(true);
      return;
    }
    if (presentation.hasMedia) {
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
  }, [cast.connected, presentation.hasMedia, presentation.remote, setCastStatus]);

  return {
    cast,
    castStatus,
    presentation,
    toggleCast,
  };
}

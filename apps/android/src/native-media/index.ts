// Re-export the native media bridge as the app-level entry point.
// The rest of the app imports from here, not directly from the module path.
export {
  PodwaffleMediaModule,
  MEDIA_EVENTS,
  type PodwaffleMediaConfig,
  type NativePlaybackState,
  type NativePlaybackStatus,
  type NativeEpisodeMedia,
  type NativeQueueSnapshot,
  type NativeDownload,
  type NativeDownloadMaintenanceResult,
  type NativeCastState,
  type NativeCastSessionSummary,
  type NativeMediaError,
} from "../../modules/podwaffle-media/src/index";

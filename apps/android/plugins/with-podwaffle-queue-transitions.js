const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod } = require("expo/config-plugins");

module.exports = function withPodwaffleQueueTransitions(config) {
  return withDangerousMod(config, ["android", async (mod) => {
    const servicePath = path.join(
      mod.modRequest.projectRoot,
      "modules",
      "podwaffle-media",
      "android",
      "src",
      "main",
      "java",
      "com",
      "podwaffle",
      "media",
      "PodwaffleMediaService.kt",
    );
    let source = fs.readFileSync(servicePath, "utf8");
    if (source.includes("Publish the new queue state before completion")) {
      return mod;
    }

    const previous = `            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                if (activeOwner() == null) return
                if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO) {
                    lastMediaItem?.let(::notifyItemEnded)
                }
                lastMediaItem = mediaItem
                lastObservedMediaId = mediaItem?.mediaId
                lastObservedPositionMs = 0L
                lastObservedDurationMs = null
                persistPlayback()
            }`;
    const replacement = `            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                if (activeOwner() == null) return
                val completedItem = if (
                    reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO
                ) {
                    lastMediaItem
                } else {
                    null
                }
                lastMediaItem = mediaItem
                lastObservedMediaId = mediaItem?.mediaId
                lastObservedPositionMs = 0L
                lastObservedDurationMs = null
                persistPlayback()
                if (completedItem != null) {
                    // Publish the new queue state before completion so an offline
                    // bridge cannot mistake the ended item for the active item and
                    // stop a next episode that ExoPlayer has already started.
                    notifyStateChanged()
                    notifyQueueChanged()
                    handler.post { notifyItemEnded(completedItem) }
                }
            }`;

    if (!source.includes(previous)) {
      throw new Error("Could not locate the native media transition listener.");
    }
    source = source.replace(previous, replacement);
    fs.writeFileSync(servicePath, source);
    return mod;
  }]);
};

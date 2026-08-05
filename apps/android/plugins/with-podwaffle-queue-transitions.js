const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod } = require("expo/config-plugins");

module.exports = function withPodwaffleQueueTransitions(config) {
  return withDangerousMod(config, ["android", async (mod) => {
    const mediaRoot = path.join(
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
    );
    const servicePath = path.join(mediaRoot, "PodwaffleMediaService.kt");
    let source = fs.readFileSync(servicePath, "utf8");

    if (!source.includes("Publish the new queue state before completion")) {
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
    }

    if (!source.includes("Retain played downloads for one day")) {
      const playedAnchor = `        lastCompletedMediaId = media.episodeId
        persistPlayback()`;
      const playedReplacement = `        lastCompletedMediaId = media.episodeId
        // Retain played downloads for one day before scheduled cleanup.
        PodwaffleCachePolicy.markPlayed(this, media.episodeId)
        persistPlayback()`;
      if (!source.includes(playedAnchor)) {
        throw new Error("Could not locate native episode completion persistence.");
      }
      source = source.replace(playedAnchor, playedReplacement);
    }

    if (!source.includes("Clear the final native playlist")) {
      const endAnchor = `        eventEmitter?.invoke(
            "media.item.ended",
            mapOf(
                "episodeId" to media.episodeId,
                "positionMs" to positionMs,
                "durationMs" to durationMs,
                "source" to source,
            ),
        )
    }

    private fun persistPlayback()`;
      const endReplacement = `        val advancedToNext = activePlayer?.currentMediaItem?.mediaId
            ?.let { it != media.episodeId }
            ?: false
        eventEmitter?.invoke(
            "media.item.ended",
            mapOf(
                "episodeId" to media.episodeId,
                "positionMs" to positionMs,
                "durationMs" to durationMs,
                "source" to source,
            ),
        )
        if (!advancedToNext) {
            // Clear the final native playlist after publishing completion. This
            // removes the media notification and prevents a later queue refresh
            // from reconstructing the episode that just finished.
            handler.post {
                val currentId = activePlayer?.currentMediaItem?.mediaId
                if (currentId == null || currentId == media.episodeId) stop()
            }
        }
    }

    private fun persistPlayback()`;
      if (!source.includes(endAnchor)) {
        throw new Error("Could not locate the native episode completion event.");
      }
      source = source.replace(endAnchor, endReplacement);
    }

    fs.writeFileSync(servicePath, source);

    const modulePath = path.join(mediaRoot, "PodwaffleMediaModule.kt");
    let moduleSource = fs.readFileSync(modulePath, "utf8");
    if (!moduleSource.includes("Cancel played-cache cleanup when queued")) {
      const queueAnchor = `                snapshot.items.forEach { media ->
                    if (`;
      const queueReplacement = `                snapshot.items.forEach { media ->
                    // Cancel played-cache cleanup when queued again so a retained
                    // file cannot be deleted while it is current or coming up.
                    PodwaffleCachePolicy.markQueued(context, media.episodeId)
                    if (`;
      if (!moduleSource.includes(queueAnchor)) {
        throw new Error("Could not locate automatic queue downloads.");
      }
      moduleSource = moduleSource.replace(queueAnchor, queueReplacement);
      fs.writeFileSync(modulePath, moduleSource);
    }

    return mod;
  }]);
};

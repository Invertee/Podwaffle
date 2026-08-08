const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod, withMainActivity } = require("expo/config-plugins");

function mediaSourcePath(projectRoot, fileName) {
  return path.join(
    projectRoot,
    "modules",
    "podwaffle-media",
    "android",
    "src",
    "main",
    "java",
    "com",
    "podwaffle",
    "media",
    fileName,
  );
}

function withSystemCastVolumeRouting(config) {
  return withMainActivity(config, (mod) => {
    if (mod.modResults.language !== "kt") {
      throw new Error("Podwaffle expects a Kotlin MainActivity.");
    }

    let source = mod.modResults.contents;
    const legacyMethod = `  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (
      event.action == KeyEvent.ACTION_DOWN &&
      PodwaffleMediaService.handleVolumeKey(event.keyCode)
    ) {
      return true
    }
    return super.dispatchKeyEvent(event)
  }

`;

    // CastPlayer now publishes its real RoutingSession through MediaSession.
    // Remove the old foreground-only key interception so Android's system
    // volume UI and hardware keys can target that remote playback session.
    source = source.replace(legacyMethod, "");

    const keyEventImport = "import android.view.KeyEvent\n";
    const withoutKeyEventImport = source.replace(keyEventImport, "");
    if (!withoutKeyEventImport.includes("KeyEvent")) {
      source = withoutKeyEventImport;
    }

    const mediaServiceImport =
      "import com.podwaffle.media.PodwaffleMediaService\n";
    const withoutMediaServiceImport = source.replace(mediaServiceImport, "");
    if (!withoutMediaServiceImport.includes("PodwaffleMediaService")) {
      source = withoutMediaServiceImport;
    }

    mod.modResults.contents = source;
    return mod;
  });
}

function withBluetoothSkipKeys(config) {
  return withDangerousMod(config, ["android", async (mod) => {
    const servicePath = mediaSourcePath(
      mod.modRequest.projectRoot,
      "PodwaffleMediaService.kt",
    );
    let source = fs.readFileSync(servicePath, "utf8");
    if (source.includes("override fun onMediaButtonEvent(")) return mod;

    const marker = `        }
    }

    private fun createPlayerListener`;
    if (!source.includes(marker)) {
      throw new Error("Could not locate the Podwaffle MediaSession callback.");
    }

    const method = `        }

        override fun onMediaButtonEvent(
            session: MediaSession,
            controllerInfo: MediaSession.ControllerInfo,
            intent: Intent,
        ): Boolean {
            @Suppress("DEPRECATION")
            val event = intent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)
                ?: return false
            val offsetMs = when (event.keyCode) {
                KeyEvent.KEYCODE_MEDIA_PREVIOUS,
                KeyEvent.KEYCODE_MEDIA_REWIND -> -(
                    NativeConfigurationStore.current?.skipBackwardMs
                        ?: DEFAULT_SKIP_BACK_MS
                )
                KeyEvent.KEYCODE_MEDIA_NEXT,
                KeyEvent.KEYCODE_MEDIA_FAST_FORWARD ->
                    NativeConfigurationStore.current?.skipForwardMs
                        ?: DEFAULT_SKIP_FORWARD_MS
                else -> return false
            }
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
                skipBy(offsetMs)
            }
            // Consume both key-down and key-up so Media3 cannot also navigate
            // to the previous or next episode in the queue.
            return true
        }
    }

    private fun createPlayerListener`;

    source = source.replace(marker, method);
    fs.writeFileSync(servicePath, source);
    return mod;
  }]);
}

function withBackgroundPlaybackReliability(config) {
  return withDangerousMod(config, ["android", async (mod) => {
    const servicePath = mediaSourcePath(
      mod.modRequest.projectRoot,
      "PodwaffleMediaService.kt",
    );
    let source = fs.readFileSync(servicePath, "utf8");

    source = source.replace(
      "player.setPauseAtEndOfMediaItems(true)",
      "player.setPauseAtEndOfMediaItems(false)",
    );

    const downloadCallback = `        downloadStore = PodwaffleDownloadStore(this) { name, payload ->
            eventEmitter?.invoke(name, payload)
        }`;
    const reliableDownloadCallback = `        downloadStore = PodwaffleDownloadStore(this) { name, payload ->
            if (name == "download.state.changed" && payload["state"] == "completed") {
                val episodeId = payload["episodeId"] as? String
                val localPath = payload["localPath"] as? String
                if (episodeId != null && localPath != null) {
                    promoteDownloadedQueueItem(episodeId, localPath)
                }
            }
            eventEmitter?.invoke(name, payload)
        }`;
    if (source.includes(downloadCallback)) {
      source = source.replace(downloadCallback, reliableDownloadCallback);
    }

    if (!source.includes("override fun onPlaybackResumption(")) {
      const callbackEnd = `            return true
        }
    }

    private fun createPlayerListener`;
      const resumptionCallback = `            return true
        }

        override fun onPlaybackResumption(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            return try {
                val raw = playbackPreferences.getString("items", null)
                    ?: return Futures.immediateFailedFuture(
                        IllegalStateException("No saved playback is available"),
                    )
                val array = JSONArray(raw)
                val media = buildList {
                    for (index in 0 until array.length()) {
                        add(EpisodeMedia.fromJson(array.getJSONObject(index)))
                    }
                }
                if (media.isEmpty()) {
                    return Futures.immediateFailedFuture(
                        IllegalStateException("No saved playback is available"),
                    )
                }
                localItems = media.map { it.toMediaItem(useDownload = true) }
                remoteItems = media.map { it.toMediaItem(useDownload = false) }
                val savedId = playbackPreferences.getString("mediaId", null)
                val savedIndex = playbackPreferences.getInt("index", 0)
                val index = media.indexOfFirst { it.episodeId == savedId }
                    .takeIf { it >= 0 }
                    ?: savedIndex.coerceIn(0, media.lastIndex)
                val position = playbackPreferences.getLong("position", 0L)
                    .coerceAtLeast(0L)
                localPlayer?.playbackParameters = PlaybackParameters(
                    playbackPreferences.getFloat("rate", 1f).coerceIn(0.5f, 4f),
                )
                lastMediaItem = localItems.getOrNull(index)
                lastObservedMediaId = lastMediaItem?.mediaId
                lastObservedPositionMs = position
                lastObservedDurationMs = media.getOrNull(index)?.durationMs
                Futures.immediateFuture(
                    MediaSession.MediaItemsWithStartPosition(
                        localItems,
                        index,
                        position,
                    ),
                )
            } catch (error: Exception) {
                Futures.immediateFailedFuture(error)
            }
        }
    }

    private fun createPlayerListener`;
      if (!source.includes(callbackEnd)) {
        throw new Error("Could not locate the MediaSession callback ending.");
      }
      source = source.replace(callbackEnd, resumptionCallback);
    }

    if (!source.includes("private fun promoteDownloadedQueueItem(")) {
      const notificationMarker = `    private fun notificationButtons(): List<CommandButton> = listOf(`;
      const promotionMethod = `    private fun promoteDownloadedQueueItem(
        episodeId: String,
        localPath: String,
    ) {
        val index = localItems.indexOfFirst { it.mediaId == episodeId }
        if (index < 0) return
        val media = EpisodeMedia.fromMediaItem(localItems[index])
            ?.withDownloadPath(localPath)
            ?: return
        val updated = media.toMediaItem(useDownload = true)
        localItems = localItems.toMutableList().also { it[index] = updated }
        val local = localPlayer
        if (
            local != null &&
            index < local.mediaItemCount &&
            index != local.currentMediaItemIndex
        ) {
            local.replaceMediaItem(index, updated)
        }
        persistPlayback()
    }

${notificationMarker}`;
      if (!source.includes(notificationMarker)) {
        throw new Error("Could not locate the notification button builder.");
      }
      source = source.replace(notificationMarker, promotionMethod);
    }

    const restoreItems = `            localItems = media.map { it.toMediaItem(useDownload = true) }
            remoteItems = media.map { it.toMediaItem(useDownload = false) }`;
    const restoreDownloadedItems = `            val restoredMedia = media.map { item ->
                item.withDownloadPath(
                    downloadStore?.completedPath(item.episodeId)
                        ?: item.localDownloadPath,
                )
            }
            localItems = restoredMedia.map { it.toMediaItem(useDownload = true) }
            remoteItems = restoredMedia.map { it.toMediaItem(useDownload = false) }`;
    if (source.includes(restoreItems)) {
      source = source.split(restoreItems).join(restoreDownloadedItems);
    }

    if (!source.includes("override fun onUpdateNotification(")) {
      const taskMarker = `    override fun onTaskRemoved(rootIntent: Intent?) {
        if (activePlayer?.isPlaying != true && !isCasting()) stopSelf()
        super.onTaskRemoved(rootIntent)
    }`;
      const lifecycleReplacement = `    override fun onUpdateNotification(
        session: MediaSession,
        startInForegroundRequired: Boolean,
    ) {
        // Keep a loaded paused episode in the foreground so Android retains the
        // media controls instead of destroying the playback service after idle.
        super.onUpdateNotification(
            session,
            startInForegroundRequired || session.player.currentMediaItem != null,
        )
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // The playback service, queue and notification are independent of the
        // React Native task. Persist state but do not stop a paused session.
        persistPlayback()
    }`;
      if (!source.includes(taskMarker)) {
        throw new Error("Could not locate the playback service task handler.");
      }
      source = source.replace(taskMarker, lifecycleReplacement);
    }

    fs.writeFileSync(servicePath, source);
    return mod;
  }]);
}

function withAutomaticQueueDownloads(config) {
  return withDangerousMod(config, ["android", async (mod) => {
    const modulePath = mediaSourcePath(
      mod.modRequest.projectRoot,
      "PodwaffleMediaModule.kt",
    );
    let source = fs.readFileSync(modulePath, "utf8");
    if (source.includes("Automatically cache every queued episode")) return mod;

    const marker = `                val store = service.getDownloadStore()
                val enriched = snapshot.items.map { media ->`;
    if (!source.includes(marker)) {
      throw new Error("Could not locate the native setQueue download store.");
    }

    const replacement = `                val store = service.getDownloadStore()
                // Automatically cache every queued episode. DownloadManager.add()
                // is idempotent for queued, active and completed items, while a
                // storage or network failure must never block the queue update.
                snapshot.items.forEach { media ->
                    if (
                        media.enclosureUrl.isNotBlank() &&
                        store.completedPath(media.episodeId) == null
                    ) {
                        runCatching { store.add(media.toMap(), "automatic") }
                    }
                }
                val enriched = snapshot.items.map { media ->`;

    source = source.replace(marker, replacement);
    fs.writeFileSync(modulePath, source);
    return mod;
  }]);
}

function withAndroidAutoQueueDownloads(config) {
  return withDangerousMod(config, ["android", async (mod) => {
    const servicePath = mediaSourcePath(
      mod.modRequest.projectRoot,
      "PodwaffleAutoMediaService.kt",
    );
    let source = fs.readFileSync(servicePath, "utf8");
    source = source.replace(
      "player.setPauseAtEndOfMediaItems(true)",
      "player.setPauseAtEndOfMediaItems(false)",
    );

    if (!source.includes("Automatically cache Android Auto queue additions")) {
      const marker = `        val media = combined.mapNotNull(EpisodeMedia::fromMediaItem)
        if (media.isEmpty()) return false
        PodwaffleMediaService.instance?.setQueue(`;
      if (!source.includes(marker)) {
        throw new Error("Could not locate the Android Auto queue update.");
      }

      const replacement = `        val media = combined.mapNotNull(EpisodeMedia::fromMediaItem)
        if (media.isEmpty()) return false
        // Automatically cache Android Auto queue additions using the same
        // idempotent DownloadManager store as the phone queue.
        val store = requireDownloadStore()
        items.mapNotNull(EpisodeMedia::fromMediaItem).forEach { queued ->
            if (
                queued.enclosureUrl.isNotBlank() &&
                store.completedPath(queued.episodeId) == null
            ) {
                runCatching { store.add(queued.toMap(), "automatic") }
            }
        }
        PodwaffleMediaService.instance?.setQueue(`;
      source = source.replace(marker, replacement);
    }

    fs.writeFileSync(servicePath, source);
    return mod;
  }]);
}

module.exports = function withPodwaffleMediaControls(config) {
  return withAndroidAutoQueueDownloads(
    withAutomaticQueueDownloads(
      withBackgroundPlaybackReliability(
        withBluetoothSkipKeys(withSystemCastVolumeRouting(config)),
      ),
    ),
  );
};

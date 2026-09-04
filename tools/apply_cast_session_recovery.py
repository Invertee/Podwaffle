from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one match in {path}, found {count}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


service = "apps/android/modules/podwaffle-media/android/src/main/java/com/podwaffle/media/PodwaffleMediaService.kt"
controller = "apps/android/src/playback/controller.ts"
layout = "apps/android/src/app/_layout.tsx"
module_kt = "apps/android/modules/podwaffle-media/android/src/main/java/com/podwaffle/media/PodwaffleMediaModule.kt"
module_ts = "apps/android/modules/podwaffle-media/src/index.ts"
test_file = "apps/android/modules/podwaffle-media/android/src/test/java/com/podwaffle/media/QueueSelectionTest.kt"

replace_once(
    service,
    '''internal fun canReconcileActiveCastQueueWithoutReload(
    activeCast: Boolean,
    currentId: String?,
    currentIndex: Int,
    candidateIds: List<String>,
): Boolean =
    activeCast &&
        currentIndex == 0 &&
        currentId != null &&
        candidateIds.firstOrNull() == currentId

internal fun shouldSuppressCastStartupTransition(''',
    '''internal fun canReconcileActiveCastQueueWithoutReload(
    activeCast: Boolean,
    currentId: String?,
    currentIndex: Int,
    candidateIds: List<String>,
): Boolean =
    activeCast &&
        currentIndex == 0 &&
        currentId != null &&
        candidateIds.firstOrNull() == currentId

internal fun shouldHoldLocalPlaybackForCastRecovery(
    explicitStop: Boolean,
    pendingCastRequest: Boolean,
    hadActiveCast: Boolean,
    savedCastAuthority: Boolean,
): Boolean =
    !explicitStop &&
        !pendingCastRequest &&
        (hadActiveCast || savedCastAuthority)

internal fun shouldAdoptExistingCastSession(
    sessionAvailable: Boolean,
    recoveryExpected: Boolean,
    currentMediaId: String?,
    knownMediaIds: Collection<String>,
): Boolean =
    sessionAvailable &&
        (recoveryExpected ||
            (currentMediaId != null && knownMediaIds.contains(currentMediaId)))

internal fun shouldSuppressCastStartupTransition(''',
)

replace_once(
    service,
    '''    private var explicitCastStop = false
    private var lastCastSnapshot = CastPlaybackSnapshot()
''',
    '''    private var explicitCastStop = false
    private var persistedCastAuthority = false
    private var castReconnectExpected = false
    private var castReconnectStartedAtMs = 0L
    private var castReconnectDeadlineMs = 0L
    private var castPlayerRebuiltForRecovery = false
    private var reconcilingCastSession = false
    private var lastCastSnapshot = CastPlaybackSnapshot()
''',
)

replace_once(
    service,
    '''        private const val CAST_STARTUP_GUARD_MS = 5_000L
        private const val ACTION_SKIP_BACK = "com.podwaffle.media.SKIP_BACK"
''',
    '''        private const val CAST_STARTUP_GUARD_MS = 5_000L
        private const val CAST_RECONNECT_GRACE_MS = 30_000L
        private const val CAST_PLAYER_REBUILD_DELAY_MS = 2_500L
        private const val ACTION_SKIP_BACK = "com.podwaffle.media.SKIP_BACK"
''',
)

replace_once(
    service,
    '''        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            return try {
''',
    '''        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            if (
                playbackPreferences.getBoolean("casting", false) ||
                castReconnectExpected ||
                isCasting()
            ) {
                return Futures.immediateFailedFuture(
                    IllegalStateException(
                        "Local playback is blocked while Cast recovery is active",
                    ),
                )
            }
            return try {
''',
)

replace_once(
    service,
    '''    private val castAvailabilityListener = object : SessionAvailabilityListener {
        override fun onCastSessionAvailable() {
            castConnecting = false
            clearCastPickerTimeout()
            transferToCast()
        }

        override fun onCastSessionUnavailable() {
            castConnecting = false
            clearCastPickerTimeout()
            val pending = pendingCastEpisodeId != null
            val position = if (pending) pendingCastPositionMs else lastCastSnapshot.positionMs
            val resume = if (pending) {
                pendingCastAutoplay
            } else {
                !explicitCastStop && lastCastSnapshot.playing
            }
            explicitCastStop = false
            transferToLocal(position, resume)
        }
    }
''',
    '''    private val castAvailabilityListener = object : SessionAvailabilityListener {
        override fun onCastSessionAvailable() {
            clearCastPickerTimeout()
            if (pendingCastEpisodeId != null) {
                transferToCast()
                return
            }
            if (!adoptExistingCastSession()) {
                castConnecting = false
                notifyCastStateChanged()
            }
        }

        override fun onCastSessionUnavailable() {
            clearCastPickerTimeout()
            if (explicitCastStop) {
                explicitCastStop = false
                clearCastRecovery(clearPersistedAuthority = true)
                notifyCastStateChanged()
                return
            }

            val pending = pendingCastEpisodeId != null
            if (pending) {
                val position = pendingCastPositionMs
                val resume = pendingCastAutoplay
                transferToLocal(position, resume)
                return
            }

            val hadActiveCast =
                lastCastSnapshot.connected || activePlayer === castPlayer
            val savedCastAuthority =
                persistedCastAuthority ||
                    playbackPreferences.getBoolean("casting", false)
            if (
                shouldHoldLocalPlaybackForCastRecovery(
                    explicitStop = false,
                    pendingCastRequest = false,
                    hadActiveCast = hadActiveCast,
                    savedCastAuthority = savedCastAuthority,
                )
            ) {
                beginCastRecovery()
                return
            }

            // SessionAvailabilityListener may report unavailable during normal
            // local startup. Do not seek or restart the local player in response.
            castConnecting = false
            notifyCastStateChanged()
        }
    }
''',
)

replace_once(
    service,
    '''        try {
            val context = CastContext.getSharedInstance(this)
            castContext = context
            castPlayer = CastPlayer(
                this,
                context,
                DefaultMediaItemConverter(),
                persistedConfiguration?.skipBackwardMs ?: DEFAULT_SKIP_BACK_MS,
                persistedConfiguration?.skipForwardMs ?: DEFAULT_SKIP_FORWARD_MS,
                5_000L,
            ).also { player ->
                player.addListener(castPlayerListener)
                player.setSessionAvailabilityListener(castAvailabilityListener)
            }
        } catch (error: Exception) {
            emitError(
                "CAST_INITIALIZATION_FAILED",
                error.message ?: "Google Cast could not be initialized",
            )
        }

        restorePlayback()
        startPositionUpdates()
        notifyCastStateChanged()
''',
    '''        // Restore the known Podwaffle queue and prior playback authority
        // before attaching the Cast listener. A saved Cast session can invoke the
        // availability callback synchronously, so both the field and metadata
        // must already exist before that callback is registered.
        restorePlayback()
        try {
            val context = CastContext.getSharedInstance(this)
            castContext = context
            installCastPlayer(context)
        } catch (error: Exception) {
            emitError(
                "CAST_INITIALIZATION_FAILED",
                error.message ?: "Google Cast could not be initialized",
            )
        }

        reconcileCastSessionState()
        startPositionUpdates()
        notifyCastStateChanged()
''',
)

replace_once(
    service,
    '''    fun stateMap(): Map<String, Any?> = MediaStateMapper.mapStateToMap(
        activePlayer,
        cast = currentCastSnapshot().takeIf { it.connected },
    )
''',
    '''    fun stateMap(): Map<String, Any?> {
        reconcileCastSessionState()
        return MediaStateMapper.mapStateToMap(
            activePlayer,
            cast = currentCastSnapshot().takeIf { it.connected },
        )
    }
''',
)

replace_once(
    service,
    '''    fun setQueue(
        local: List<MediaItem>,
        remote: List<MediaItem>,
        requestedIndex: Int,
    ) {
        localItems = local
        remoteItems = remote
        val player = activePlayer ?: return
''',
    '''    fun setQueue(
        local: List<MediaItem>,
        remote: List<MediaItem>,
        requestedIndex: Int,
    ) {
        localItems = local
        remoteItems = remote
        reconcileCastSessionState()
        val player = activePlayer ?: return
''',
)

replace_once(
    service,
    '''    fun play() {
        activePlayer?.apply {
            playWhenReady = true
            play()
        }
''',
    '''    fun play() {
        reconcileCastSessionState()
        if (castReconnectExpected && !isCasting()) {
            // A transient Cast disconnect must never start a second local stream.
            localPlayer?.pause()
            notifyCastStateChanged()
            notifyStateChanged()
            return
        }
        activePlayer?.apply {
            playWhenReady = true
            play()
        }
''',
)

replace_once(
    service,
    '''    fun pause() {
        activePlayer?.pause()
''',
    '''    fun pause() {
        reconcileCastSessionState()
        activePlayer?.pause()
''',
)

replace_once(
    service,
    '''    fun stop() {
        activePlayer?.apply {
''',
    '''    fun stop() {
        clearCastRecovery(clearPersistedAuthority = true)
        activePlayer?.apply {
''',
)

replace_once(
    service,
    '''    fun seekTo(positionMs: Long) {
        val player = activePlayer
''',
    '''    fun seekTo(positionMs: Long) {
        reconcileCastSessionState()
        val player = activePlayer
''',
)

replace_once(
    service,
    '''    fun castPlay(): Map<String, Any?> {
        val player = castPlayer ?: throw IllegalStateException("Google Cast is unavailable")
''',
    '''    fun castPlay(): Map<String, Any?> {
        reconcileCastSessionState()
        val player = castPlayer ?: throw IllegalStateException("Google Cast is unavailable")
''',
)

replace_once(
    service,
    '''    fun castPause(): Map<String, Any?> {
        val player = castPlayer ?: throw IllegalStateException("Google Cast is unavailable")
''',
    '''    fun castPause(): Map<String, Any?> {
        reconcileCastSessionState()
        val player = castPlayer ?: throw IllegalStateException("Google Cast is unavailable")
''',
)

replace_once(
    service,
    '''    fun castSeek(positionMs: Long): Map<String, Any?> {
        val player = castPlayer ?: throw IllegalStateException("Google Cast is unavailable")
''',
    '''    fun castSeek(positionMs: Long): Map<String, Any?> {
        reconcileCastSessionState()
        val player = castPlayer ?: throw IllegalStateException("Google Cast is unavailable")
''',
)

replace_once(
    service,
    '''    fun getCastState(): Map<String, Any?> {
        val snapshot = currentCastSnapshot()
        val devices = availableCastRoutes()
        return snapshot.copy(
            available = castContext != null,
            connecting = castConnecting,
            availableDevices = devices,
        ).toMap()
    }

    fun markCastPickerOpened() {
''',
    '''    fun getCastState(): Map<String, Any?> {
        val snapshot = currentCastSnapshot()
        val devices = availableCastRoutes()
        return snapshot.copy(
            available = castContext != null,
            connecting = castConnecting || castReconnectExpected,
            availableDevices = devices,
        ).toMap()
    }

    fun refreshCastSession(): Map<String, Any?> {
        reconcileCastSessionState()
        return getCastState()
    }

    fun markCastPickerOpened() {
''',
)

replace_once(
    service,
    '''    private fun transferToCast() {
        val remote = castPlayer ?: return
        if (!remote.isCastSessionAvailable) return
''',
    '''    private fun transferToCast() {
        val remote = castPlayer ?: return
        if (!remote.isCastSessionAvailable) return
        clearCastRecovery(clearPersistedAuthority = false)
        persistedCastAuthority = true
''',
)

replace_once(
    service,
    '''    fun notifyCastStateChanged() {
        val state = getCastState()
        eventEmitter?.invoke("cast.state.changed", state)
        @Suppress("UNCHECKED_CAST")
        val session = state["session"] as? Map<String, Any?>
        if (session != null) {
            eventEmitter?.invoke(
                "cast.volume.changed",
                mapOf("volume" to session["volume"], "muted" to session["muted"]),
            )
        }
    }

    private fun transferToCast() {
''',
    '''    fun notifyCastStateChanged() {
        val state = getCastState()
        eventEmitter?.invoke("cast.state.changed", state)
        @Suppress("UNCHECKED_CAST")
        val session = state["session"] as? Map<String, Any?>
        if (session != null) {
            eventEmitter?.invoke(
                "cast.volume.changed",
                mapOf("volume" to session["volume"], "muted" to session["muted"]),
            )
        }
    }

    private fun installCastPlayer(context: CastContext) {
        val configuration = NativeConfigurationStore.current
        val player = CastPlayer(
            this,
            context,
            DefaultMediaItemConverter(),
            configuration?.skipBackwardMs ?: DEFAULT_SKIP_BACK_MS,
            configuration?.skipForwardMs ?: DEFAULT_SKIP_FORWARD_MS,
            5_000L,
        )
        // Assign before registering the listener. The Cast SDK may synchronously
        // announce a resumed session from setSessionAvailabilityListener().
        castPlayer = player
        player.addListener(castPlayerListener)
        player.setSessionAvailabilityListener(castAvailabilityListener)
    }

    private fun rebuildCastPlayerForRecovery() {
        if (castPlayerRebuiltForRecovery) return
        val context = castContext ?: return
        castPlayerRebuiltForRecovery = true
        val previous = castPlayer
        if (activePlayer === previous) {
            localPlayer?.pause()
            activePlayer = localPlayer
            localPlayer?.let { mediaSession?.setPlayer(it) }
        }
        previous?.setSessionAvailabilityListener(null)
        previous?.removeListener(castPlayerListener)
        previous?.release()
        castPlayer = null
        installCastPlayer(context)
    }

    private fun beginCastRecovery() {
        val now = System.currentTimeMillis()
        if (!castReconnectExpected) {
            castReconnectStartedAtMs = now
            castReconnectDeadlineMs = now + CAST_RECONNECT_GRACE_MS
            castPlayerRebuiltForRecovery = false
        }
        castReconnectExpected = true
        castConnecting = true
        persistedCastAuthority = true
        localPlayer?.pause()
        castPlayer?.let { remote ->
            activePlayer = remote
            mediaSession?.setPlayer(remote)
        }
        lastCastSnapshot = lastCastSnapshot.copy(
            available = castContext != null,
            connecting = true,
            connected = true,
        )
        playbackPreferences.edit()
            .putBoolean("casting", true)
            .putBoolean("castPlaying", lastCastSnapshot.playing)
            .apply()
        persistPlayback()
        notifyCastStateChanged()
        notifyStateChanged()
    }

    private fun clearCastRecovery(clearPersistedAuthority: Boolean) {
        castReconnectExpected = false
        castReconnectStartedAtMs = 0L
        castReconnectDeadlineMs = 0L
        castPlayerRebuiltForRecovery = false
        castConnecting = false
        if (clearPersistedAuthority) {
            persistedCastAuthority = false
            playbackPreferences.edit()
                .putBoolean("casting", false)
                .putBoolean("castPlaying", false)
                .apply()
        }
    }

    private fun reconcileCastSessionState() {
        if (reconcilingCastSession) return
        reconcilingCastSession = true
        try {
            val remote = castPlayer
            if (remote?.isCastSessionAvailable == true) {
                if (pendingCastEpisodeId != null) transferToCast()
                else adoptExistingCastSession()
                return
            }

            if (
                !castReconnectExpected &&
                (persistedCastAuthority ||
                    (lastCastSnapshot.connected && activePlayer === remote))
            ) {
                beginCastRecovery()
            }
            if (!castReconnectExpected) return

            val now = System.currentTimeMillis()
            if (
                currentCastSession() != null &&
                !castPlayerRebuiltForRecovery &&
                now - castReconnectStartedAtMs >= CAST_PLAYER_REBUILD_DELAY_MS
            ) {
                rebuildCastPlayerForRecovery()
                if (castPlayer?.isCastSessionAvailable == true) {
                    adoptExistingCastSession()
                    return
                }
            }

            if (castReconnectDeadlineMs > 0L && now >= castReconnectDeadlineMs) {
                val position = lastCastSnapshot.positionMs
                clearCastRecovery(clearPersistedAuthority = true)
                // A confirmed Cast loss returns to a paused local player. Starting
                // local audio automatically risks playing over a still-running
                // receiver when the sender alone has lost connectivity.
                transferToLocal(position, resume = false)
            }
        } finally {
            reconcilingCastSession = false
        }
    }

    private fun adoptExistingCastSession(): Boolean {
        val remote = castPlayer ?: return false
        val currentItem = remote.currentMediaItem
        val currentMedia = EpisodeMedia.fromMediaItem(currentItem)
        val currentId = currentItem?.mediaId ?: currentMedia?.episodeId
        val knownIds = buildSet {
            localItems.forEach { add(it.mediaId) }
            remoteItems.forEach { add(it.mediaId) }
            lastCastSnapshot.episode?.episodeId?.let(::add)
        }
        if (
            !shouldAdoptExistingCastSession(
                sessionAvailable = remote.isCastSessionAvailable,
                recoveryExpected = castReconnectExpected || persistedCastAuthority,
                currentMediaId = currentId,
                knownMediaIds = knownIds,
            )
        ) {
            return false
        }

        currentMedia?.let { media ->
            val localMedia = media.withDownloadPath(
                downloadStore?.completedPath(media.episodeId)
                    ?: media.localDownloadPath,
            )
            localItems = upsertQueueItem(
                localItems,
                localMedia.toMediaItem(useDownload = true),
            )
            remoteItems = upsertQueueItem(
                remoteItems,
                media.toMediaItem(useDownload = false),
            )
        }
        localPlayer?.pause()
        activePlayer = remote
        mediaSession?.setPlayer(remote)
        clearPendingCast()
        clearCastRecovery(clearPersistedAuthority = false)
        persistedCastAuthority = true

        val snapshot = currentCastSnapshot().copy(connecting = false)
        lastCastSnapshot = snapshot
        lastMediaItem = currentItem ?: lastMediaItem
        lastObservedMediaId = snapshot.episode?.episodeId ?: currentId
        lastObservedPositionMs = snapshot.positionMs
        lastObservedDurationMs = snapshot.durationMs
        persistPlayback()
        notifyQueueChanged()
        notifyCastStateChanged()
        notifyStateChanged()
        return true
    }

    private fun transferToCast() {
''',
)

replace_once(
    service,
    '''    private fun transferToLocal(positionMs: Long, resume: Boolean) {
        clearCastStartupGuard()
        val local = localPlayer ?: return
        if (activePlayer === local && !isCasting()) {
            if (local.currentMediaItem != null) {
                local.seekTo(positionMs.coerceAtLeast(0L))
                local.playWhenReady = resume
                if (resume) local.play() else local.pause()
            }
            clearPendingCast()
            persistPlayback()
            notifyCastStateChanged()
            notifyStateChanged()
            return
        }
''',
    '''    private fun transferToLocal(positionMs: Long, resume: Boolean) {
        clearCastStartupGuard()
        clearCastRecovery(clearPersistedAuthority = true)
        val local = localPlayer ?: return
        lastCastSnapshot = CastPlaybackSnapshot(
            available = castContext != null,
            availableDevices = availableCastRoutes(),
        )
        if (activePlayer === local && !isCasting()) {
            if (local.currentMediaItem != null) {
                local.seekTo(positionMs.coerceAtLeast(0L))
                local.playWhenReady = resume
                if (resume) local.play() else local.pause()
            }
            clearPendingCast()
            persistPlayback()
            notifyCastStateChanged()
            notifyStateChanged()
            return
        }
''',
)

replace_once(
    service,
    '''        lastObservedMediaId = lastMediaItem?.mediaId
        lastObservedPositionMs = positionMs.coerceAtLeast(0L)
        lastObservedDurationMs = EpisodeMedia.fromMediaItem(lastMediaItem)?.durationMs
        lastCastSnapshot = CastPlaybackSnapshot()
        clearPendingCast()
''',
    '''        lastObservedMediaId = lastMediaItem?.mediaId
        lastObservedPositionMs = positionMs.coerceAtLeast(0L)
        lastObservedDurationMs = EpisodeMedia.fromMediaItem(lastMediaItem)?.durationMs
        clearPendingCast()
''',
)

replace_once(
    service,
    '''        if (player == null || session == null || !player.isCastSessionAvailable) {
            return if (lastCastSnapshot.connected && activePlayer === castPlayer) {
                lastCastSnapshot
            } else {
''',
    '''        if (player == null || session == null || !player.isCastSessionAvailable) {
            return if (
                lastCastSnapshot.connected &&
                (activePlayer === castPlayer ||
                    castReconnectExpected ||
                    persistedCastAuthority)
            ) {
                lastCastSnapshot.copy(
                    available = castContext != null,
                    connecting = castConnecting || castReconnectExpected,
                )
            } else {
''',
)

replace_once(
    service,
    '''    private fun startPositionUpdates() {
        positionNotifier = object : Runnable {
            override fun run() {
                val player = activePlayer
''',
    '''    private fun startPositionUpdates() {
        positionNotifier = object : Runnable {
            override fun run() {
                reconcileCastSessionState()
                val player = activePlayer
''',
)

replace_once(
    service,
    '''    private fun persistPlayback() {
        val player = activePlayer ?: return
        val currentId = player.currentMediaItem?.mediaId ?: run {
            clearPersistedPlayback()
            return
        }
        val serializableItems = localItems.mapNotNull(EpisodeMedia::fromMediaItem)
        if (serializableItems.isEmpty()) return
        val currentIndex = serializableItems.indexOfFirst { it.episodeId == currentId }
            .takeIf { it >= 0 }
            ?: player.currentMediaItemIndex.coerceIn(0, serializableItems.lastIndex)
        val items = JSONArray().apply {
            serializableItems.forEach { put(it.toJson()) }
        }
        playbackPreferences.edit()
            .putString("items", items.toString())
            .putInt("index", currentIndex)
            .putString("mediaId", currentId)
            .putLong("position", player.currentPosition.coerceAtLeast(0L))
            .putFloat("rate", player.playbackParameters.speed)
            .apply()
        lastPersistAt = System.currentTimeMillis()
    }
''',
    '''    private fun persistPlayback() {
        val player = activePlayer ?: return
        val casting = activePlayer === castPlayer || castReconnectExpected
        val castSnapshot = if (casting) currentCastSnapshot() else null
        val currentId = player.currentMediaItem?.mediaId
            ?: if (casting) {
                castSnapshot?.episode?.episodeId ?: lastObservedMediaId
            } else {
                null
            }
        if (currentId == null) {
            if (!casting) clearPersistedPlayback()
            return
        }
        val serializableItems = localItems.mapNotNull(EpisodeMedia::fromMediaItem)
        if (serializableItems.isEmpty()) return
        val currentIndex = serializableItems.indexOfFirst { it.episodeId == currentId }
            .takeIf { it >= 0 }
            ?: player.currentMediaItemIndex.coerceIn(0, serializableItems.lastIndex)
        val items = JSONArray().apply {
            serializableItems.forEach { put(it.toJson()) }
        }
        playbackPreferences.edit()
            .putString("items", items.toString())
            .putInt("index", currentIndex)
            .putString("mediaId", currentId)
            .putLong(
                "position",
                castSnapshot?.positionMs ?: player.currentPosition.coerceAtLeast(0L),
            )
            .putFloat("rate", player.playbackParameters.speed)
            .putBoolean("casting", casting)
            .putBoolean("castPlaying", castSnapshot?.playing ?: false)
            .putString("castSessionId", castSnapshot?.sessionId)
            .putString("castDeviceName", castSnapshot?.deviceName)
            .apply()
        persistedCastAuthority = casting
        lastPersistAt = System.currentTimeMillis()
    }
''',
)

replace_once(
    service,
    '''            lastMediaItem = localItems.getOrNull(index)
            lastObservedMediaId = lastMediaItem?.mediaId
            lastObservedPositionMs = position
            lastObservedDurationMs = media.getOrNull(index)?.durationMs
        } catch (_: Exception) {
''',
    '''            lastMediaItem = localItems.getOrNull(index)
            lastObservedMediaId = lastMediaItem?.mediaId
            lastObservedPositionMs = position
            lastObservedDurationMs = media.getOrNull(index)?.durationMs

            persistedCastAuthority = playbackPreferences.getBoolean("casting", false)
            if (persistedCastAuthority) {
                val now = System.currentTimeMillis()
                val wasPlaying = playbackPreferences.getBoolean("castPlaying", false)
                castReconnectExpected = true
                castReconnectStartedAtMs = now
                castReconnectDeadlineMs = now + CAST_RECONNECT_GRACE_MS
                castPlayerRebuiltForRecovery = false
                castConnecting = true
                lastCastSnapshot = CastPlaybackSnapshot(
                    available = false,
                    connecting = true,
                    connected = true,
                    sessionId = playbackPreferences.getString(
                        "castSessionId",
                        "cast-session",
                    ) ?: "cast-session",
                    deviceName = playbackPreferences.getString(
                        "castDeviceName",
                        "Cast device",
                    ),
                    playing = wasPlaying,
                    mediaLoaded = true,
                    playerState = if (wasPlaying) "playing" else "paused",
                    positionMs = position,
                    durationMs = media.getOrNull(index)?.durationMs,
                    episode = restoredMedia.getOrNull(index),
                )
            }
        } catch (_: Exception) {
''',
)

replace_once(
    service,
    '''    override fun onDestroy() {
        persistPlayback()
        clearCastPickerTimeout()
''',
    '''    override fun onDestroy() {
        persistPlayback()
        clearCastPickerTimeout()
''',
)

replace_once(
    module_kt,
    '''        AsyncFunction("getCastState") {
            onMain {
                PodwaffleMediaService.instance?.getCastState()
                    ?: mapOf(
''',
    '''        AsyncFunction("refreshCastSession") {
            withServiceOnMain(PodwaffleMediaService::refreshCastSession)
        }

        AsyncFunction("getCastState") {
            onMain {
                PodwaffleMediaService.instance?.getCastState()
                    ?: mapOf(
''',
)

replace_once(
    module_ts,
    '''  stopCast(input: { stopReceiver: boolean }): Promise<NativeCastState>;
  getCastState(): Promise<NativeCastState>;
  setCastVolume(volume: number): Promise<NativeCastState>;
''',
    '''  stopCast(input: { stopReceiver: boolean }): Promise<NativeCastState>;
  refreshCastSession(): Promise<NativeCastState>;
  getCastState(): Promise<NativeCastState>;
  setCastVolume(volume: number): Promise<NativeCastState>;
''',
)

replace_once(
    module_ts,
    '''  stopCast(input: { stopReceiver: boolean }): Promise<NativeCastState> {
    return nativeModule.stopCast(input);
  },
  getCastState(): Promise<NativeCastState> {
''',
    '''  stopCast(input: { stopReceiver: boolean }): Promise<NativeCastState> {
    return nativeModule.stopCast(input);
  },
  refreshCastSession(): Promise<NativeCastState> {
    return nativeModule.refreshCastSession();
  },
  getCastState(): Promise<NativeCastState> {
''',
)

replace_once(
    controller,
    '''  public handleCastState(castState: NativeCastState): void {
    const previous = this.lastCastState;
    this.lastCastState = castState;
    useNativeMediaStore.getState().updateCastState(castState);
    this.sampleListening();

    if (castState.connected && castState.session) {
      usePlayerUiStore.getState().setCastStatus("connected");
      if (
        castState.session.episodeId &&
        this.activeEpisode?.id !== castState.session.episodeId
      ) {
        void this.resolveEpisode(castState.session.episodeId).then(
          (episode) => {
            if (
              !episode ||
              useNativeMediaStore.getState().castState.session?.episodeId !==
                episode.id
            ) {
              return;
            }
            this.activeEpisode = episode;
            // A restored Cast session can arrive before JS has reconstructed
            // its episode object. Retry the confirmation once metadata exists
            // so the receiver's position is not lost across process death.
            void this.reportCastState(true).catch(() => undefined);
          },
        );
      }
      const takeover = this.castTakeoverRequested;
      this.castTakeoverRequested = false;
      void this.reportCastState(!this.castBackendActive, undefined, takeover);
      return;
    }

    if (previous?.connected && previous.session && !this.endingCast) {
      void this.restoreLocalAfterCast(previous);
      return;
    }

    if (
      !castState.connecting &&
      usePlayerUiStore.getState().castStatus === "connecting"
    ) {
      this.castTakeoverRequested = false;
      usePlayerUiStore.getState().setCastStatus("idle");
    }
  }
''',
    '''  public handleCastState(castState: NativeCastState): void {
    const previous = this.lastCastState;
    this.lastCastState = castState;
    useNativeMediaStore.getState().updateCastState(castState);
    this.sampleListening();

    if (castState.connected && castState.session) {
      usePlayerUiStore
        .getState()
        .setCastStatus(castState.connecting ? "connecting" : "connected");
      if (
        castState.session.episodeId &&
        this.activeEpisode?.id !== castState.session.episodeId
      ) {
        void this.resolveEpisode(castState.session.episodeId).then(
          (episode) => {
            if (
              !episode ||
              useNativeMediaStore.getState().castState.session?.episodeId !==
                episode.id
            ) {
              return;
            }
            this.activeEpisode = episode;
            if (!useNativeMediaStore.getState().castState.connecting) {
              // A restored Cast session can arrive before JS has reconstructed
              // its episode object. Retry confirmation once metadata exists.
              void this.reportCastState(true).catch(() => undefined);
            }
          },
        );
      }
      if (castState.connecting) return;
      const takeover = this.castTakeoverRequested;
      this.castTakeoverRequested = false;
      void this.reportCastState(!this.castBackendActive, undefined, takeover);
      return;
    }

    if (castState.connecting) {
      usePlayerUiStore.getState().setCastStatus("connecting");
      return;
    }

    if (previous?.connected && previous.session && !this.endingCast) {
      void this.restoreLocalAfterCast(previous);
      return;
    }

    if (usePlayerUiStore.getState().castStatus === "connecting") {
      this.castTakeoverRequested = false;
      usePlayerUiStore.getState().setCastStatus("idle");
    }
  }
''',
)

replace_once(
    controller,
    '''    const cast = useNativeMediaStore.getState().castState;
    const episodeId = cast.session?.episodeId;
    if (this.clearingPlayback || !cast.connected || !cast.session || !episodeId)
      return;
''',
    '''    const cast = useNativeMediaStore.getState().castState;
    const episodeId = cast.session?.episodeId;
    if (
      this.clearingPlayback ||
      cast.connecting ||
      !cast.connected ||
      !cast.session ||
      !episodeId
    )
      return;
''',
)

replace_once(
    controller,
    '''  private async restoreLocalAfterCast(
    previous: NativeCastState,
  ): Promise<void> {
    const session = previous.session;
    if (!session) return;
    const resume = session.playerState === "playing";
    try {
      await this.stopBackendCast(
        session.positionMs,
        session.durationMs,
        resume ? "playing" : "paused",
        session.episodeId ?? this.activeEpisode?.id ?? null,
        session.sessionId,
      );
    } catch {
      // A server-side idle timeout may already have cleared the Cast owner.
    }
    this.castBackendActive = false;
    await PodwaffleMediaModule.seekTo(session.positionMs).catch(
      () => undefined,
    );
    if (resume) await PodwaffleMediaModule.play().catch(() => undefined);
    else await PodwaffleMediaModule.pause().catch(() => undefined);
    usePlayerUiStore.getState().setCastStatus("idle");
  }
''',
    '''  private async restoreLocalAfterCast(
    previous: NativeCastState,
  ): Promise<void> {
    const session = previous.session;
    if (!session) return;
    try {
      await this.stopBackendCast(
        session.positionMs,
        session.durationMs,
        "paused",
        session.episodeId ?? this.activeEpisode?.id ?? null,
        session.sessionId,
      );
    } catch {
      // A server-side idle timeout may already have cleared the Cast owner.
    }
    this.castBackendActive = false;
    await PodwaffleMediaModule.seekTo(session.positionMs).catch(
      () => undefined,
    );
    // Never auto-resume after an unexpected Cast loss. The receiver may still
    // be playing even when this sender has lost its session connection.
    await PodwaffleMediaModule.pause().catch(() => undefined);
    usePlayerUiStore.getState().setCastStatus("idle");
  }
''',
)

replace_once(
    layout,
    '''    try {
      const [initialState, castState] = await Promise.all([
        PodwaffleMediaModule.bind(),
        PodwaffleMediaModule.getCastState().catch(() => null),
      ]);
      updateState(initialState);
''',
    '''    try {
      // Give the native service a chance to re-adopt a resumed Cast session
      // before exposing local playback state to React Native.
      const castState = await PodwaffleMediaModule.refreshCastSession().catch(
        () => null,
      );
      const initialState = await PodwaffleMediaModule.bind();
      updateState(initialState);
''',
)

replace_once(
    layout,
    '''  const refreshConnectionState = useCallback(async () => {
    try {
      applyConnectionState(await PodwaffleConnectivityModule.getState());
    } catch {
      playbackSyncPolicy.setTransport("unknown");
      setNetworkTransport("unknown");
    }
  }, [applyConnectionState]);

  useEffect(() => void restore(), [restore]);
''',
    '''  const refreshConnectionState = useCallback(async () => {
    try {
      applyConnectionState(await PodwaffleConnectivityModule.getState());
    } catch {
      playbackSyncPolicy.setTransport("unknown");
      setNetworkTransport("unknown");
    }
  }, [applyConnectionState]);

  const refreshNativeCastSession = useCallback(async () => {
    const cast = await PodwaffleMediaModule.refreshCastSession().catch(
      () => null,
    );
    if (cast) playbackController.handleCastState(cast);
  }, []);

  useEffect(() => void restore(), [restore]);
''',
)

replace_once(
    layout,
    '''  useEffect(() => {
    if (status === "authenticated" && credentials && liveSyncEnabled) {
      const currentRevision = useAuthStore.getState().snapshot?.revision ?? 0;
      syncRuntime.start(credentials, currentRevision);
    } else {
      syncRuntime.stop();
    }
    return () => syncRuntime.stop();
  }, [status, credentials, liveSyncEnabled]);

  useEffect(() => {
    const previous = priorLiveSyncEnabled.current;
''',
    '''  useEffect(() => {
    if (status === "authenticated" && credentials && liveSyncEnabled) {
      const currentRevision = useAuthStore.getState().snapshot?.revision ?? 0;
      syncRuntime.start(credentials, currentRevision);
    } else {
      syncRuntime.stop();
    }
    return () => syncRuntime.stop();
  }, [status, credentials, liveSyncEnabled]);

  useEffect(() => {
    if (status !== "authenticated" || !credentials) return;
    const check = () => {
      if (AppState.currentState === "active") void refreshNativeCastSession();
    };
    check();
    const timer = setInterval(check, 10_000);
    return () => clearInterval(timer);
  }, [status, credentials, refreshNativeCastSession]);

  useEffect(() => {
    const previous = priorLiveSyncEnabled.current;
''',
)

replace_once(
    layout,
    '''      if (state === "active") {
        void refreshConnectionState();
        void refresh();
''',
    '''      if (state === "active") {
        void refreshNativeCastSession();
        void refreshConnectionState();
        void refresh();
''',
)

replace_once(
    layout,
    '''    return () => subscription.remove();
  }, [refresh, refreshConnectionState]);
''',
    '''    return () => subscription.remove();
  }, [refresh, refreshConnectionState, refreshNativeCastSession]);
''',
)

replace_once(
    test_file,
    '''    @Test
    fun suppressesOnlyUnexpectedAutomaticTransitionsDuringCastStartup() {
''',
    '''    @Test
    fun holdsLocalPlaybackDuringTransientOrSavedCastRecovery() {
        assertTrue(
            shouldHoldLocalPlaybackForCastRecovery(
                explicitStop = false,
                pendingCastRequest = false,
                hadActiveCast = true,
                savedCastAuthority = false,
            ),
        )
        assertTrue(
            shouldHoldLocalPlaybackForCastRecovery(
                explicitStop = false,
                pendingCastRequest = false,
                hadActiveCast = false,
                savedCastAuthority = true,
            ),
        )
        assertFalse(
            shouldHoldLocalPlaybackForCastRecovery(
                explicitStop = true,
                pendingCastRequest = false,
                hadActiveCast = true,
                savedCastAuthority = true,
            ),
        )
        assertFalse(
            shouldHoldLocalPlaybackForCastRecovery(
                explicitStop = false,
                pendingCastRequest = true,
                hadActiveCast = true,
                savedCastAuthority = true,
            ),
        )
    }

    @Test
    fun adoptsOnlyKnownOrRecoveringCastSessions() {
        val known = listOf("current", "next")
        assertTrue(
            shouldAdoptExistingCastSession(
                sessionAvailable = true,
                recoveryExpected = false,
                currentMediaId = "current",
                knownMediaIds = known,
            ),
        )
        assertTrue(
            shouldAdoptExistingCastSession(
                sessionAvailable = true,
                recoveryExpected = true,
                currentMediaId = null,
                knownMediaIds = known,
            ),
        )
        assertFalse(
            shouldAdoptExistingCastSession(
                sessionAvailable = true,
                recoveryExpected = false,
                currentMediaId = "another-app",
                knownMediaIds = known,
            ),
        )
        assertFalse(
            shouldAdoptExistingCastSession(
                sessionAvailable = false,
                recoveryExpected = true,
                currentMediaId = "current",
                knownMediaIds = known,
            ),
        )
    }

    @Test
    fun suppressesOnlyUnexpectedAutomaticTransitionsDuringCastStartup() {
''',
)

replace_once(
    "apps/android/app.config.ts",
    '''  version: "0.4.34",''',
    '''  version: "0.4.35",''',
)
replace_once(
    "apps/android/app.config.ts",
    '''    buildNumber: "36",''',
    '''    buildNumber: "37",''',
)
replace_once(
    "apps/android/app.config.ts",
    '''    versionCode: 38,''',
    '''    versionCode: 39,''',
)
replace_once(
    "apps/android/app.config.ts",
    '''    nativeRuntimeVersion: "0.4-native-28",''',
    '''    nativeRuntimeVersion: "0.4-native-29",''',
)
replace_once(
    "apps/android/package.json",
    '''  "version": "0.4.34",''',
    '''  "version": "0.4.35",''',
)
replace_once(
    "apps/android/modules/podwaffle-media/package.json",
    '''  "version": "0.4.22",''',
    '''  "version": "0.4.23",''',
)
replace_once(
    "apps/android/modules/podwaffle-media/android/build.gradle",
    '''version = '0.4.22' ''',
    '''version = '0.4.23' ''',
)
replace_once(
    "apps/android/modules/podwaffle-media/android/build.gradle",
    '''    versionCode 26
    versionName "0.4.22"''',
    '''    versionCode 27
    versionName "0.4.23"''',
)

replace_once(
    "CHANGELOG.md",
    '''## Unreleased

''',
    '''## Unreleased

- Made Android retain and re-adopt active Google Cast sessions across transient
  sender disconnects, process recreation, and foreground transitions; blocked
  local media resumption while Cast recovery is pending; and changed a confirmed
  Cast loss to return to local playback paused instead of starting a duplicate
  stream. Added periodic native and foreground Cast reconciliation. Updated
  Android to 0.4.35 / versionCode 39 / native runtime 0.4-native-29.
''',
)

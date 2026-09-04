from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one match in {path}, found {count}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


service = "apps/android/modules/podwaffle-media/android/src/main/java/com/podwaffle/media/PodwaffleMediaService.kt"

replace_once(
    service,
    '''            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                val player = activeOwner() ?: return
                if (
                    player === castPlayer &&
                    shouldSuppressCastStartupTransition(
''',
    '''            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                val player = activeOwner() ?: return
                if (player === castPlayer && castReconnectExpected) {
                    // A sender reconnect can temporarily clear or replace the
                    // CastPlayer item while the receiver continues normally.
                    // Do not treat that transport churn as episode completion.
                    return
                }
                if (
                    player === castPlayer &&
                    shouldSuppressCastStartupTransition(
''',
)

replace_once(
    service,
    '''            override fun onEvents(player: Player, events: Player.Events) {
                if (player !== activePlayer) return
                if (
                    player === castPlayer &&
                    castStartupGuardActive() &&
''',
    '''            override fun onEvents(player: Player, events: Player.Events) {
                if (player !== activePlayer) return
                if (player === castPlayer && castReconnectExpected) return
                if (
                    player === castPlayer &&
                    castStartupGuardActive() &&
''',
)

replace_once(
    service,
    '''    private fun rebuildCastPlayerForRecovery() {
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
''',
    '''    private fun rebuildCastPlayerForRecovery() {
        if (castPlayerRebuiltForRecovery) return
        val context = castContext ?: return
        castPlayerRebuiltForRecovery = true
        val previous = castPlayer
        val wasActive = activePlayer === previous
        previous?.setSessionAvailabilityListener(null)
        previous?.removeListener(castPlayerListener)

        try {
            // Build and attach the replacement before releasing the old sender.
            // The media session is never pointed at the local player during this
            // operation, so a hardware/system play command cannot start duplicate
            // phone audio in the middle of Cast recovery.
            installCastPlayer(context)
            val replacement = castPlayer
            if (wasActive && replacement != null && activePlayer === previous) {
                activePlayer = replacement
                mediaSession?.setPlayer(replacement)
            }
            previous?.release()
        } catch (error: Exception) {
            castPlayer = previous
            previous?.addListener(castPlayerListener)
            previous?.setSessionAvailabilityListener(castAvailabilityListener)
            emitError(
                "CAST_RECONNECTION_FAILED",
                error.message ?: "Google Cast could not be reconnected",
            )
        }
    }
''',
)

replace_once(
    service,
    '''            val remote = castPlayer
            if (remote?.isCastSessionAvailable == true) {
                if (pendingCastEpisodeId != null) transferToCast()
                else adoptExistingCastSession()
                return
            }
''',
    '''            val remote = castPlayer
            if (remote?.isCastSessionAvailable == true) {
                if (pendingCastEpisodeId != null) {
                    transferToCast()
                } else if (
                    activePlayer !== remote ||
                    castReconnectExpected ||
                    castConnecting ||
                    !lastCastSnapshot.connected
                ) {
                    adoptExistingCastSession()
                }
                return
            }
''',
)

replace_once(
    service,
    '''    private fun transferToLocal(positionMs: Long, resume: Boolean) {
        clearCastStartupGuard()
        clearCastRecovery(clearPersistedAuthority = true)
        val local = localPlayer ?: return
        lastCastSnapshot = CastPlaybackSnapshot(
''',
    '''    private fun transferToLocal(positionMs: Long, resume: Boolean) {
        val previousCastSnapshot = lastCastSnapshot
        clearCastStartupGuard()
        clearCastRecovery(clearPersistedAuthority = true)
        val local = localPlayer ?: return
        lastCastSnapshot = CastPlaybackSnapshot(
''',
)

replace_once(
    service,
    '''        val currentId = lastCastSnapshot.episode?.episodeId
            ?: castPlayer?.currentMediaItem?.mediaId
''',
    '''        val currentId = previousCastSnapshot.episode?.episodeId
            ?: castPlayer?.currentMediaItem?.mediaId
''',
)

replace_once(
    service,
    '''    private fun restorePlayback() {
        val raw = playbackPreferences.getString("items", null) ?: return
        try {
''',
    '''    private fun restorePlayback() {
        val raw = playbackPreferences.getString("items", null) ?: return
        val savedCastAuthority = playbackPreferences.getBoolean("casting", false)
        try {
''',
)

replace_once(
    service,
    '''            persistedCastAuthority = playbackPreferences.getBoolean("casting", false)
            if (persistedCastAuthority) {
''',
    '''            persistedCastAuthority = savedCastAuthority
            if (persistedCastAuthority) {
''',
)

replace_once(
    service,
    '''    private fun clearPersistedPlayback() {
        playbackPreferences.edit().clear().apply()
    }
''',
    '''    private fun clearPersistedPlayback() {
        persistedCastAuthority = false
        playbackPreferences.edit().clear().apply()
    }
''',
)

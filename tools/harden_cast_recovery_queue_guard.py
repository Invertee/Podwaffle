from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one match in {path}, found {count}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


service = "apps/android/modules/podwaffle-media/android/src/main/java/com/podwaffle/media/PodwaffleMediaService.kt"
test_file = "apps/android/modules/podwaffle-media/android/src/test/java/com/podwaffle/media/QueueSelectionTest.kt"

replace_once(
    service,
    '''internal fun shouldAdoptExistingCastSession(
    sessionAvailable: Boolean,
''',
    '''internal fun shouldDeferNativePlaybackMutationForCastRecovery(
    recoveryExpected: Boolean,
    sessionAvailable: Boolean,
): Boolean = recoveryExpected && !sessionAvailable

internal fun shouldAdoptExistingCastSession(
    sessionAvailable: Boolean,
''',
)

replace_once(
    service,
    '''        localItems = local
        remoteItems = remote
        reconcileCastSessionState()
        val player = activePlayer ?: return
''',
    '''        localItems = local
        remoteItems = remote
        reconcileCastSessionState()
        if (
            shouldDeferNativePlaybackMutationForCastRecovery(
                recoveryExpected = castReconnectExpected,
                sessionAvailable = isCasting(),
            )
        ) {
            // Keep the refreshed queue in memory, but do not load or prepare it
            // on either player until the existing receiver has been re-adopted.
            persistPlayback()
            notifyCastStateChanged()
            notifyStateChanged()
            return
        }
        val player = activePlayer ?: return
''',
)

replace_once(
    service,
    '''    fun playEpisode(
        local: MediaItem,
        remote: MediaItem,
        startPositionMs: Long,
        autoplay: Boolean = true,
    ) {
        upsertQueueItem(localItems, local).also { localItems = it }
        upsertQueueItem(remoteItems, remote).also { remoteItems = it }

        val candidates = if (isCasting()) remoteItems else localItems
''',
    '''    fun playEpisode(
        local: MediaItem,
        remote: MediaItem,
        startPositionMs: Long,
        autoplay: Boolean = true,
    ) {
        upsertQueueItem(localItems, local).also { localItems = it }
        upsertQueueItem(remoteItems, remote).also { remoteItems = it }
        reconcileCastSessionState()
        if (
            shouldDeferNativePlaybackMutationForCastRecovery(
                recoveryExpected = castReconnectExpected,
                sessionAvailable = isCasting(),
            )
        ) {
            throw IllegalStateException("The Cast session is reconnecting")
        }

        val candidates = if (isCasting()) remoteItems else localItems
''',
)

replace_once(
    service,
    '''            if (!castReconnectExpected) return

            val now = System.currentTimeMillis()
''',
    '''            if (!castReconnectExpected) return

            // Keep MediaSession transport commands attached to the CastPlayer
            // placeholder throughout recovery. The local player stays paused and
            // cannot be resumed by Android while the receiver may still be active.
            remote?.let { recoveringPlayer ->
                if (activePlayer !== recoveringPlayer) {
                    localPlayer?.pause()
                    activePlayer = recoveringPlayer
                    mediaSession?.setPlayer(recoveringPlayer)
                }
            }

            val now = System.currentTimeMillis()
''',
)

replace_once(
    service,
    '''                if (castPlayer?.isCastSessionAvailable == true) {
                    adoptExistingCastSession()
                    return
                }
''',
    '''                val replacement = castPlayer
                if (
                    replacement?.isCastSessionAvailable == true &&
                    (activePlayer !== replacement ||
                        castReconnectExpected ||
                        castConnecting ||
                        !lastCastSnapshot.connected)
                ) {
                    adoptExistingCastSession()
                    return
                }
''',
)

replace_once(
    test_file,
    '''    @Test
    fun adoptsOnlyKnownOrRecoveringCastSessions() {
''',
    '''    @Test
    fun defersNativePlaybackMutationOnlyWhileCastRecoveryIsUnresolved() {
        assertTrue(
            shouldDeferNativePlaybackMutationForCastRecovery(
                recoveryExpected = true,
                sessionAvailable = false,
            ),
        )
        assertFalse(
            shouldDeferNativePlaybackMutationForCastRecovery(
                recoveryExpected = true,
                sessionAvailable = true,
            ),
        )
        assertFalse(
            shouldDeferNativePlaybackMutationForCastRecovery(
                recoveryExpected = false,
                sessionAvailable = false,
            ),
        )
    }

    @Test
    fun adoptsOnlyKnownOrRecoveringCastSessions() {
''',
)

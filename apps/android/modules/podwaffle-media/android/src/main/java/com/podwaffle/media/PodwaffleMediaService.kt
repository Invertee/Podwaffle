package com.podwaffle.media

import android.app.PendingIntent
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import androidx.media3.cast.CastPlayer
import androidx.media3.cast.DefaultMediaItemConverter
import androidx.media3.cast.SessionAvailabilityListener
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.CommandButton
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import androidx.mediarouter.media.MediaRouter
import com.google.android.gms.cast.MediaStatus
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import org.json.JSONArray
import kotlin.math.roundToInt

internal data class QueueSelection(val index: Int, val positionMs: Long)

internal fun reconcileQueueSelection(
    candidateIds: List<String>,
    currentId: String?,
    currentPositionMs: Long,
    requestedIndex: Int,
): QueueSelection {
    val matchingIndex = candidateIds.indexOf(currentId).takeIf { it >= 0 }
    return QueueSelection(
        index = matchingIndex ?: requestedIndex.coerceIn(0, candidateIds.lastIndex),
        positionMs = if (matchingIndex != null) currentPositionMs.coerceAtLeast(0L) else 0L,
    )
}

internal fun canReconcileActiveCastQueueWithoutReload(
    activeCast: Boolean,
    currentId: String?,
    currentIndex: Int,
    candidateIds: List<String>,
): Boolean =
    activeCast &&
        currentIndex == 0 &&
        currentId != null &&
        candidateIds.firstOrNull() == currentId

internal fun shouldSuppressCastStartupTransition(
    reason: Int,
    guardActive: Boolean,
    expectedMediaId: String?,
    transitionedMediaId: String?,
): Boolean =
    reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO &&
        guardActive &&
        expectedMediaId != null &&
        transitionedMediaId != expectedMediaId

internal fun shouldGuardCastStartupPosition(
    positionMs: Long,
    durationMs: Long?,
    guardWindowMs: Long = 5_000L,
): Boolean =
    durationMs == null ||
        durationMs <= 0L ||
        positionMs < (durationMs - guardWindowMs).coerceAtLeast(0L)

/**
 * Long-lived Android playback authority for local, downloaded and Cast media.
 *
 * The React Native layer owns Podwaffle REST/WebSocket synchronisation while this
 * service owns the players and MediaSession. This keeps notification, headset,
 * lock-screen and Cast transport controls alive across navigation and task removal.
 */
@UnstableApi
class PodwaffleMediaService : MediaSessionService() {
    private var localPlayer: ExoPlayer? = null
    private var castPlayer: CastPlayer? = null
    private var activePlayer: Player? = null
    private var mediaSession: MediaSession? = null
    private var castContext: CastContext? = null
    private var downloadStore: PodwaffleDownloadStore? = null
    private val playbackPreferences by lazy {
        getSharedPreferences("podwaffle.native.playback.v2", MODE_PRIVATE)
    }

    private val handler = Handler(Looper.getMainLooper())
    private var positionNotifier: Runnable? = null
    private var castPickerTimeout: Runnable? = null

    private var localItems: List<MediaItem> = emptyList()
    private var remoteItems: List<MediaItem> = emptyList()
    private var castConnecting = false
    private var pendingCastEpisodeId: String? = null
    private var pendingCastPositionMs = 0L
    private var pendingCastAutoplay = false
    private var castStartupEpisodeId: String? = null
    private var castStartupPositionMs = 0L
    private var castStartupAutoplay = false
    private var castStartupGuardUntilMs = 0L
    private var castStartupCorrectionScheduled = false
    private var explicitCastStop = false
    private var lastCastSnapshot = CastPlaybackSnapshot()
    private var lastMediaItem: MediaItem? = null
    private var lastObservedMediaId: String? = null
    private var lastObservedPositionMs = 0L
    private var lastObservedDurationMs: Long? = null
    private var lastCompletedMediaId: String? = null
    private var lastPersistAt = 0L

    companion object {
        private const val DEFAULT_SKIP_BACK_MS = 15_000L
        private const val DEFAULT_SKIP_FORWARD_MS = 30_000L
        private const val CAST_VOLUME_STEP = 0.05f
        private const val CAST_STARTUP_GUARD_MS = 5_000L
        private const val ACTION_SKIP_BACK = "com.podwaffle.media.SKIP_BACK"
        private const val ACTION_SKIP_FORWARD = "com.podwaffle.media.SKIP_FORWARD"

        private val skipBackCommand = SessionCommand(ACTION_SKIP_BACK, Bundle.EMPTY)
        private val skipForwardCommand = SessionCommand(ACTION_SKIP_FORWARD, Bundle.EMPTY)

        var instance: PodwaffleMediaService? = null
            private set

        var eventEmitter: ((eventName: String, params: Map<String, Any?>) -> Unit)? = null
            set(value) {
                field = value
                instance?.downloadStore?.emitAll()
                instance?.notifyStateChanged()
                instance?.notifyCastStateChanged()
            }

        /**
         * Routes foreground hardware volume keys to the active Cast receiver.
         * Returning false lets Android handle the phone's normal media volume.
         */
        @JvmStatic
        fun handleVolumeKey(keyCode: Int): Boolean {
            val service = instance ?: return false
            val state = service.getCastState()
            if (state["connected"] != true) return false
            val delta = when (keyCode) {
                KeyEvent.KEYCODE_VOLUME_UP -> CAST_VOLUME_STEP
                KeyEvent.KEYCODE_VOLUME_DOWN -> -CAST_VOLUME_STEP
                else -> return false
            }
            @Suppress("UNCHECKED_CAST")
            val session = state["session"] as? Map<String, Any?>
            val current = (session?.get("volume") as? Number)?.toFloat() ?: 0.5f
            service.setCastVolume((current + delta).coerceIn(0f, 1f))
            return true
        }
    }

    private val localPlayerListener: Player.Listener by lazy {
        createPlayerListener { localPlayer }
    }

    private val castPlayerListener: Player.Listener by lazy {
        createPlayerListener { castPlayer }
    }

    private val mediaSessionCallback = object : MediaSession.Callback {
        override fun onConnect(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
        ): MediaSession.ConnectionResult {
            val builder = MediaSession.ConnectionResult.AcceptedResultBuilder(session)
            if (!session.isMediaNotificationController(controller)) return builder.build()

            val sessionCommands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS
                .buildUpon()
                .add(skipBackCommand)
                .add(skipForwardCommand)
                .build()
            val playerCommands = MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS
                .buildUpon()
                // Keep the notification as transport controls rather than a
                // second seek UI. The two explicit commands below still seek.
                .remove(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)
                .remove(Player.COMMAND_SEEK_TO_DEFAULT_POSITION)
                .remove(Player.COMMAND_SEEK_TO_MEDIA_ITEM)
                .remove(Player.COMMAND_SEEK_TO_PREVIOUS)
                .remove(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                .remove(Player.COMMAND_SEEK_TO_NEXT)
                .remove(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                .remove(Player.COMMAND_SEEK_BACK)
                .remove(Player.COMMAND_SEEK_FORWARD)
                .build()
            val buttons = notificationButtons()
            return builder
                .setAvailableSessionCommands(sessionCommands)
                .setAvailablePlayerCommands(playerCommands)
                .setCustomLayout(buttons)
                .setMediaButtonPreferences(buttons)
                .build()
        }

        override fun onCustomCommand(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand,
            args: Bundle,
        ): ListenableFuture<SessionResult> {
            val configuration = NativeConfigurationStore.current
            val offsetMs = when (customCommand.customAction) {
                ACTION_SKIP_BACK -> -(
                    configuration?.skipBackwardMs ?: DEFAULT_SKIP_BACK_MS
                )
                ACTION_SKIP_FORWARD ->
                    configuration?.skipForwardMs ?: DEFAULT_SKIP_FORWARD_MS
                else -> return Futures.immediateFuture(
                    SessionResult(SessionError.ERROR_NOT_SUPPORTED),
                )
            }
            skipBy(offsetMs)
            return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
        }

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

    private fun createPlayerListener(owner: () -> Player?): Player.Listener =
        object : Player.Listener {
            private fun activeOwner(): Player? = owner()?.takeIf { it === activePlayer }

            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                val player = activeOwner() ?: return
                if (
                    player === castPlayer &&
                    shouldSuppressCastStartupTransition(
                        reason,
                        castStartupGuardActive(),
                        castStartupEpisodeId,
                        mediaItem?.mediaId,
                    )
                ) {
                    // Ignore transient Cast queue advancement while Media3 swaps
                    // from the local player. Restore any concrete wrong item to
                    // the episode and position explicitly selected for Cast.
                    if (mediaItem != null) restoreCastStartupSelection()
                    return
                }
                val completedItem = if (
                    reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO &&
                    lastMediaItem?.mediaId != mediaItem?.mediaId
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
            }

            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                if (activeOwner() == null) return
                // Automatic completion is handled by onMediaItemTransition,
                // which still has the outgoing MediaItem. By the time this
                // callback runs currentMediaItem may already be the next item;
                // treating it as ended completes and skips the new episode.
                persistPlayback()
            }

            override fun onPlaybackParametersChanged(
                playbackParameters: PlaybackParameters,
            ) {
                if (activeOwner() == null) return
                persistPlayback()
            }

            override fun onPositionDiscontinuity(
                oldPosition: Player.PositionInfo,
                newPosition: Player.PositionInfo,
                reason: Int,
            ) {
                if (activeOwner() == null) return
                persistPlayback()
            }

            override fun onEvents(player: Player, events: Player.Events) {
                if (player !== activePlayer) return
                if (
                    player === castPlayer &&
                    castStartupGuardActive() &&
                    player.currentMediaItem?.mediaId != castStartupEpisodeId
                ) {
                    if (player.currentMediaItem != null) restoreCastStartupSelection()
                    return
                }
                if (player === castPlayer) notifyCastStateChanged()
                notifyStateChanged()
                if (events.contains(Player.EVENT_MEDIA_ITEM_TRANSITION)) {
                    notifyQueueChanged()
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                if (activeOwner() == null) return
                val message = error.message ?: "Playback error"
                emitError(error.errorCodeName, message)
                notifyStateChanged(error.errorCodeName to message)
            }
        }

    private val castAvailabilityListener = object : SessionAvailabilityListener {
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

    override fun onCreate() {
        super.onCreate()
        instance = this
        val persistedConfiguration = NativeConfigurationPersistence.load(this)
        NotificationHelper.createNotificationChannels(this)
        downloadStore = PodwaffleDownloadStore(this) { name, payload ->
            if (name == "download.state.changed" && payload["state"] == "completed") {
                val episodeId = payload["episodeId"] as? String
                val localPath = payload["localPath"] as? String
                if (episodeId != null && localPath != null) {
                    promoteDownloadedQueueItem(episodeId, localPath)
                }
            }
            eventEmitter?.invoke(name, payload)
        }

        val local = ExoPlayer.Builder(this)
            .setSeekBackIncrementMs(
                persistedConfiguration?.skipBackwardMs ?: DEFAULT_SKIP_BACK_MS,
            )
            .setSeekForwardIncrementMs(
                persistedConfiguration?.skipForwardMs ?: DEFAULT_SKIP_FORWARD_MS,
            )
            .build()
            .also { player ->
                player.setHandleAudioBecomingNoisy(true)
                player.setPauseAtEndOfMediaItems(false)
                player.addListener(localPlayerListener)
            }
        localPlayer = local
        activePlayer = local

        val notificationProvider = DefaultMediaNotificationProvider.Builder(this)
            .setChannelId(NotificationHelper.PLAYBACK_CHANNEL_ID)
            .setNotificationId(NotificationHelper.PLAYBACK_NOTIFICATION_ID)
            .build()
        notificationProvider.setSmallIcon(R.drawable.ic_podwaffle_notification)
        setMediaNotificationProvider(notificationProvider)

        val mediaButtons = notificationButtons()
        val sessionBuilder = MediaSession.Builder(this, local)
            .setCallback(mediaSessionCallback)
            .setCustomLayout(mediaButtons)
            .setMediaButtonPreferences(mediaButtons)
        createSessionActivity()?.let(sessionBuilder::setSessionActivity)
        val session = sessionBuilder.build()
        mediaSession = session
        addSession(session)

        try {
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
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? =
        mediaSession

    fun getPlayer(): Player? = activePlayer

    fun getDownloadStore(): PodwaffleDownloadStore =
        requireNotNull(downloadStore) { "Download store has not been initialized" }

    fun stateMap(): Map<String, Any?> = MediaStateMapper.mapStateToMap(
        activePlayer,
        cast = currentCastSnapshot().takeIf { it.connected },
    )

    fun setQueue(
        local: List<MediaItem>,
        remote: List<MediaItem>,
        requestedIndex: Int,
    ) {
        localItems = local
        remoteItems = remote
        val player = activePlayer ?: return
        val candidates = if (isCasting()) remoteItems else localItems
        if (candidates.isEmpty()) {
            player.clearMediaItems()
            clearPersistedPlayback()
            notifyQueueChanged()
            notifyStateChanged()
            return
        }

        val currentId = player.currentMediaItem?.mediaId
        val currentPosition = player.currentPosition.coerceAtLeast(0L)
        val candidateIds = candidates.map { it.mediaId }
        if (
            canReconcileActiveCastQueueWithoutReload(
                player === castPlayer && isCasting(),
                currentId,
                player.currentMediaItemIndex,
                candidateIds,
            )
        ) {
            // Do not reload/prepare the active Cast item for a queue-only change.
            // CastPlayer.setMediaItems() sends a receiver queue load which can
            // briefly pause playback and, on some receivers, detach the sender.
            // The playback invariant keeps the current episode at queue index 0,
            // so mutate only the future queue while the receiver keeps playing.
            reconcileActiveCastQueueTail(player, candidates)
            lastMediaItem = player.currentMediaItem
            lastObservedMediaId = currentId
            lastObservedPositionMs = currentPosition
            lastObservedDurationMs =
                EpisodeMedia.fromMediaItem(player.currentMediaItem)?.durationMs
                    ?: lastObservedDurationMs
            persistPlayback()
            notifyQueueChanged()
            notifyCastStateChanged()
            notifyStateChanged()
            return
        }
        val selection = reconcileQueueSelection(
            candidateIds,
            currentId,
            currentPosition,
            requestedIndex,
        )
        // A queue refresh may remove the old item and select a different head.
        // Carrying the old (often near-end) position into that new identity can
        // immediately complete and skip the new podcast.
        val shouldPlay = player.playWhenReady
        val speed = player.playbackParameters.speed
        player.setMediaItems(candidates, selection.index, selection.positionMs)
        lastMediaItem = candidates.getOrNull(selection.index)
        player.playbackParameters = PlaybackParameters(speed)
        player.prepare()
        player.playWhenReady = shouldPlay
        if (shouldPlay) player.play()
        persistPlayback()
        notifyQueueChanged()
        notifyStateChanged()
    }

    private fun reconcileActiveCastQueueTail(
        player: Player,
        candidates: List<MediaItem>,
    ) {
        val desiredTail = candidates.drop(1)
        val existingTail = buildList {
            for (index in 1 until player.mediaItemCount) {
                add(player.getMediaItemAt(index))
            }
        }
        var sharedPrefix = 0
        while (
            sharedPrefix < existingTail.size &&
            sharedPrefix < desiredTail.size &&
            existingTail[sharedPrefix].mediaId == desiredTail[sharedPrefix].mediaId
        ) {
            sharedPrefix += 1
        }

        val replaceFrom = 1 + sharedPrefix
        if (player.mediaItemCount > replaceFrom) {
            player.removeMediaItems(replaceFrom, player.mediaItemCount)
        }
        val replacement = desiredTail.drop(sharedPrefix)
        if (replacement.isNotEmpty()) {
            player.addMediaItems(replaceFrom, replacement)
        }
    }

    fun playEpisode(
        local: MediaItem,
        remote: MediaItem,
        startPositionMs: Long,
        autoplay: Boolean = true,
    ) {
        upsertQueueItem(localItems, local).also { localItems = it }
        upsertQueueItem(remoteItems, remote).also { remoteItems = it }

        val candidates = if (isCasting()) remoteItems else localItems
        val index = candidates.indexOfFirst { it.mediaId == local.mediaId }
            .takeIf { it >= 0 }
            ?: 0
        val player = activePlayer ?: return
        lastCompletedMediaId = null
        player.setMediaItems(candidates, index, startPositionMs.coerceAtLeast(0L))
        lastMediaItem = candidates.getOrNull(index)
        player.prepare()
        player.playWhenReady = autoplay
        if (autoplay) player.play()
        persistPlayback()
        notifyQueueChanged()
        notifyStateChanged()
    }

    fun play() {
        activePlayer?.apply {
            playWhenReady = true
            play()
        }
        persistPlayback()
        notifyStateChanged()
        if (isCasting()) notifyCastStateChanged()
    }

    fun pause() {
        activePlayer?.pause()
        persistPlayback()
        notifyStateChanged()
        if (isCasting()) notifyCastStateChanged()
    }

    fun stop() {
        activePlayer?.apply {
            stop()
            clearMediaItems()
        }
        localItems = emptyList()
        remoteItems = emptyList()
        lastCompletedMediaId = null
        clearPersistedPlayback()
        notifyQueueChanged()
        notifyStateChanged()
        if (isCasting()) notifyCastStateChanged()
    }

    fun seekTo(positionMs: Long) {
        val player = activePlayer
        val target = positionMs.coerceAtLeast(0L)
        val duration = player?.duration?.takeIf { it > 0L }
        if (
            player?.currentMediaItem?.mediaId == lastCompletedMediaId &&
            (duration == null || target < duration - 2_000L)
        ) {
            lastCompletedMediaId = null
        }
        player?.seekTo(target)
        persistPlayback()
        notifyPositionChanged()
        notifyStateChanged()
        if (isCasting()) notifyCastStateChanged()
    }

    fun skipBy(offsetMs: Long) {
        val player = activePlayer ?: return
        val requested = (player.currentPosition + offsetMs).coerceAtLeast(0L)
        val target = player.duration.takeIf { it > 0L }?.let(requested::coerceAtMost)
            ?: requested
        seekTo(target)
    }

    fun next() {
        activePlayer?.let { player ->
            if (player.hasNextMediaItem()) player.seekToNextMediaItem()
        }
        notifyStateChanged()
        notifyQueueChanged()
    }

    fun previous() {
        activePlayer?.let { player ->
            if (player.currentPosition > 5_000L || !player.hasPreviousMediaItem()) {
                player.seekTo(0L)
            } else {
                player.seekToPreviousMediaItem()
            }
        }
        notifyStateChanged()
        notifyQueueChanged()
    }

    fun setPlaybackRate(rate: Float) {
        activePlayer?.playbackParameters = PlaybackParameters(rate.coerceIn(0.5f, 4f))
        persistPlayback()
        notifyStateChanged()
    }

    /** Prepare the current episode before opening the system Cast chooser. */
    fun prepareCast(mediaId: String, positionMs: Long, autoplay: Boolean) {
        pendingCastEpisodeId = mediaId
        pendingCastPositionMs = positionMs.coerceAtLeast(0L)
        pendingCastAutoplay = autoplay
        castConnecting = !isCasting()
        scheduleCastPickerTimeout()
        if (isCasting()) transferToCast()
        notifyCastStateChanged()
    }

    fun castPlay(): Map<String, Any?> {
        val player = castPlayer ?: throw IllegalStateException("Google Cast is unavailable")
        if (!player.isCastSessionAvailable) throw IllegalStateException("No Cast session is active")
        player.playWhenReady = true
        player.play()
        notifyCastStateChanged()
        notifyStateChanged()
        return getCastState()
    }

    fun castPause(): Map<String, Any?> {
        val player = castPlayer ?: throw IllegalStateException("Google Cast is unavailable")
        if (!player.isCastSessionAvailable) throw IllegalStateException("No Cast session is active")
        player.pause()
        notifyCastStateChanged()
        notifyStateChanged()
        return getCastState()
    }

    fun castSeek(positionMs: Long): Map<String, Any?> {
        val player = castPlayer ?: throw IllegalStateException("Google Cast is unavailable")
        if (!player.isCastSessionAvailable) throw IllegalStateException("No Cast session is active")
        player.seekTo(positionMs.coerceAtLeast(0L))
        notifyCastStateChanged()
        notifyStateChanged()
        return getCastState()
    }

    fun setCastVolume(volume: Float): Map<String, Any?> {
        val normalized = volume.coerceIn(0f, 1f)
        castPlayer?.let { player ->
            val device = player.deviceInfo
            val range = (device.maxVolume - device.minVolume).coerceAtLeast(0)
            if (
                range > 0 &&
                player.isCommandAvailable(Player.COMMAND_SET_DEVICE_VOLUME_WITH_FLAGS)
            ) {
                val deviceVolume = device.minVolume + (normalized * range).roundToInt()
                player.setDeviceVolume(deviceVolume, C.VOLUME_FLAG_SHOW_UI)
            } else {
                // Retain support for receivers/Media3 implementations which only
                // expose the Cast SDK's normalized stream volume.
                player.volume = normalized
            }
        }
        currentCastSession()?.let { session ->
            runCatching { session.volume = normalized.toDouble() }
        }
        notifyCastStateChanged()
        return getCastState()
    }

    fun stopCast(stopReceiver: Boolean): Map<String, Any?> {
        val snapshot = currentCastSnapshot()
        explicitCastStop = true
        castConnecting = false
        clearCastPickerTimeout()
        transferToLocal(snapshot.positionMs, false)
        castContext?.sessionManager?.endCurrentSession(stopReceiver)
        notifyCastStateChanged()
        return getCastState()
    }

    fun getCastState(): Map<String, Any?> {
        val snapshot = currentCastSnapshot()
        val devices = availableCastRoutes()
        return snapshot.copy(
            available = castContext != null,
            connecting = castConnecting,
            availableDevices = devices,
        ).toMap()
    }

    fun markCastPickerOpened() {
        castConnecting = !isCasting()
        scheduleCastPickerTimeout()
        notifyCastStateChanged()
    }

    fun notifyStateChanged(error: Pair<String, String>? = null) {
        eventEmitter?.invoke(
            "media.state.changed",
            MediaStateMapper.mapStateToMap(
                activePlayer,
                cast = currentCastSnapshot().takeIf { it.connected },
                lastError = error,
            ),
        )
        refreshSystemNotification()
    }

    private fun refreshSystemNotification() {
        runCatching { triggerNotificationUpdate() }
    }

    fun notifyCastStateChanged() {
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
        val remote = castPlayer ?: return
        if (!remote.isCastSessionAvailable) return
        val local = localPlayer ?: return
        val mediaId = pendingCastEpisodeId ?: local.currentMediaItem?.mediaId
        val index = remoteItems.indexOfFirst { it.mediaId == mediaId }
            .takeIf { it >= 0 }
            ?: local.currentMediaItemIndex.coerceAtLeast(0)
                .coerceIn(0, (remoteItems.size - 1).coerceAtLeast(0))
        val position = if (pendingCastEpisodeId != null) {
            pendingCastPositionMs
        } else {
            local.currentPosition.coerceAtLeast(0L)
        }
        val autoplay = if (pendingCastEpisodeId != null) pendingCastAutoplay else local.playWhenReady
        val speed = local.playbackParameters.speed
        val targetItem = remoteItems.getOrNull(index)

        val targetDurationMs = EpisodeMedia.fromMediaItem(targetItem)?.durationMs
        castStartupEpisodeId = targetItem?.mediaId ?: mediaId
        castStartupPositionMs = position
        castStartupAutoplay = autoplay
        castStartupGuardUntilMs = if (shouldGuardCastStartupPosition(position, targetDurationMs)) {
            System.currentTimeMillis() + CAST_STARTUP_GUARD_MS
        } else {
            0L
        }
        castStartupCorrectionScheduled = false
        lastMediaItem = targetItem
        lastObservedMediaId = targetItem?.mediaId
        lastObservedPositionMs = position
        lastObservedDurationMs = targetDurationMs

        if (remoteItems.isNotEmpty()) {
            // A CastPlayer can inherit playWhenReady from an existing receiver
            // session. Freeze it before replacing the queue so it cannot advance
            // the newly selected episode while the new start position is loading.
            remote.playWhenReady = false
            runCatching { remote.pause() }
            remote.setMediaItems(remoteItems, index, position)
            remote.playbackParameters = PlaybackParameters(speed)
            remote.prepare()
            remote.playWhenReady = autoplay
            if (autoplay) remote.play()
        }
        local.pause()
        activePlayer = remote
        mediaSession?.setPlayer(remote)
        clearPendingCast()
        castConnecting = false
        lastCastSnapshot = currentCastSnapshot()
        persistPlayback()
        notifyQueueChanged()
        notifyCastStateChanged()
        notifyStateChanged()
    }

    private fun castStartupGuardActive(): Boolean =
        castStartupEpisodeId != null &&
            System.currentTimeMillis() <= castStartupGuardUntilMs

    private fun restoreCastStartupSelection() {
        if (castStartupCorrectionScheduled || !castStartupGuardActive()) return
        val expectedMediaId = castStartupEpisodeId ?: return
        castStartupCorrectionScheduled = true
        handler.post {
            castStartupCorrectionScheduled = false
            if (!castStartupGuardActive() || castStartupEpisodeId != expectedMediaId) return@post
            val remote = castPlayer ?: return@post
            if (activePlayer !== remote || !remote.isCastSessionAvailable) return@post
            val index = remoteItems.indexOfFirst { it.mediaId == expectedMediaId }
            if (index < 0 || remote.currentMediaItem?.mediaId == expectedMediaId) return@post
            val targetItem = remoteItems[index]
            val speed = remote.playbackParameters.speed

            remote.playWhenReady = false
            runCatching { remote.pause() }
            lastMediaItem = targetItem
            lastObservedMediaId = expectedMediaId
            lastObservedPositionMs = castStartupPositionMs
            lastObservedDurationMs = EpisodeMedia.fromMediaItem(targetItem)?.durationMs
            remote.setMediaItems(remoteItems, index, castStartupPositionMs)
            remote.playbackParameters = PlaybackParameters(speed)
            remote.prepare()
            remote.playWhenReady = castStartupAutoplay
            if (castStartupAutoplay) remote.play()
            lastCastSnapshot = currentCastSnapshot()
            persistPlayback()
            notifyQueueChanged()
            notifyCastStateChanged()
            notifyStateChanged()
        }
    }

    private fun clearCastStartupGuard() {
        castStartupEpisodeId = null
        castStartupPositionMs = 0L
        castStartupAutoplay = false
        castStartupGuardUntilMs = 0L
        castStartupCorrectionScheduled = false
    }

    private fun transferToLocal(positionMs: Long, resume: Boolean) {
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
        val currentId = lastCastSnapshot.episode?.episodeId
            ?: castPlayer?.currentMediaItem?.mediaId
        val index = localItems.indexOfFirst { it.mediaId == currentId }
            .takeIf { it >= 0 }
            ?: 0
        val speed = castPlayer?.playbackParameters?.speed ?: local.playbackParameters.speed

        if (localItems.isNotEmpty()) {
            local.setMediaItems(
                localItems,
                index.coerceIn(0, localItems.lastIndex),
                positionMs.coerceAtLeast(0L),
            )
            local.playbackParameters = PlaybackParameters(speed)
            local.prepare()
            local.playWhenReady = resume
            if (resume) local.play()
        }
        activePlayer = local
        mediaSession?.setPlayer(local)
        lastMediaItem = localItems.getOrNull(index)
        lastObservedMediaId = lastMediaItem?.mediaId
        lastObservedPositionMs = positionMs.coerceAtLeast(0L)
        lastObservedDurationMs = EpisodeMedia.fromMediaItem(lastMediaItem)?.durationMs
        lastCastSnapshot = CastPlaybackSnapshot()
        clearPendingCast()
        persistPlayback()
        notifyQueueChanged()
        notifyCastStateChanged()
        notifyStateChanged()
    }

    private fun currentCastSnapshot(): CastPlaybackSnapshot {
        val player = castPlayer
        val session = currentCastSession()
        if (player == null || session == null || !player.isCastSessionAvailable) {
            return if (lastCastSnapshot.connected && activePlayer === castPlayer) {
                lastCastSnapshot
            } else {
                CastPlaybackSnapshot(
                    available = castContext != null,
                    connecting = castConnecting,
                    availableDevices = availableCastRoutes(),
                )
            }
        }
        val previous = lastCastSnapshot
        val currentMedia = EpisodeMedia.fromMediaItem(player.currentMediaItem)
        val sameEpisode = currentMedia == null ||
            currentMedia.episodeId == previous.episode?.episodeId
        val media = currentMedia ?: previous.episode
        val state = when {
            player.playbackState == Player.STATE_BUFFERING -> "buffering"
            player.isPlaying ||
                (player.playWhenReady && player.playbackState == Player.STATE_READY) -> "playing"
            player.playbackState == Player.STATE_READY -> "paused"
            player.playbackState == Player.STATE_IDLE || player.playbackState == Player.STATE_ENDED -> "idle"
            else -> "unknown"
        }
        val rawPosition = player.currentPosition.coerceAtLeast(0L)
        val preservePreviousPosition =
            rawPosition == 0L &&
                previous.connected &&
                sameEpisode &&
                (state == "idle" || player.currentMediaItem == null)
        val position = if (preservePreviousPosition) previous.positionMs else rawPosition
        val duration = player.duration.takeIf { it > 0L }
            ?: currentMedia?.durationMs
            ?: previous.durationMs.takeIf { sameEpisode }
        val idleReason = when (session.remoteMediaClient?.mediaStatus?.idleReason) {
            MediaStatus.IDLE_REASON_FINISHED -> "finished"
            MediaStatus.IDLE_REASON_CANCELED -> "cancelled"
            MediaStatus.IDLE_REASON_INTERRUPTED -> "interrupted"
            MediaStatus.IDLE_REASON_ERROR -> "error"
            else -> null
        }
        val snapshot = CastPlaybackSnapshot(
            available = true,
            connecting = castConnecting,
            connected = true,
            sessionId = session.sessionId ?: "cast-session",
            deviceName = session.castDevice?.friendlyName ?: "Cast device",
            volume = session.volume.coerceIn(0.0, 1.0),
            muted = session.isMute,
            playing = state == "playing",
            buffering = state == "buffering",
            mediaLoaded = player.currentMediaItem != null && player.playbackState != Player.STATE_IDLE,
            playerState = state,
            idleReason = idleReason,
            positionMs = position,
            durationMs = duration,
            episode = media,
            availableDevices = availableCastRoutes(),
        )
        lastCastSnapshot = snapshot
        return snapshot
    }

    private fun currentCastSession(): CastSession? =
        castContext?.sessionManager?.currentCastSession

    private fun isCasting(): Boolean = castPlayer?.isCastSessionAvailable == true

    private fun availableCastRoutes(): List<String> = try {
        MediaRouter.getInstance(this).routes
            .filter { route -> route.isEnabled && !route.isDefault && !route.isBluetooth }
            .map { route -> route.name.toString() }
            .distinct()
    } catch (_: Exception) {
        emptyList()
    }

    private fun createSessionActivity(): PendingIntent? {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName) ?: return null
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun promoteDownloadedQueueItem(
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

    private fun notificationButtons(): List<CommandButton> = listOf(
        CommandButton.Builder(CommandButton.ICON_SKIP_BACK)
            .setDisplayName("Skip back")
            .setSessionCommand(skipBackCommand)
            .setSlots(CommandButton.SLOT_BACK)
            .build(),
        CommandButton.Builder(CommandButton.ICON_SKIP_FORWARD)
            .setDisplayName("Skip forward")
            .setSessionCommand(skipForwardCommand)
            .setSlots(CommandButton.SLOT_FORWARD)
            .build(),
    )

    private fun startPositionUpdates() {
        positionNotifier = object : Runnable {
            override fun run() {
                val player = activePlayer
                if (
                    player != null &&
                    (player.isPlaying || player.playbackState == Player.STATE_BUFFERING)
                ) {
                    notifyPositionChanged()
                    if (System.currentTimeMillis() - lastPersistAt >= 10_000L) {
                        persistPlayback()
                    }
                    if (player === castPlayer) notifyCastStateChanged()
                }
                handler.postDelayed(this, 1_000L)
            }
        }
        handler.post(positionNotifier!!)
    }

    private fun notifyPositionChanged() {
        activePlayer?.let { player ->
            lastObservedMediaId = player.currentMediaItem?.mediaId
            lastObservedPositionMs = player.currentPosition.coerceAtLeast(0L)
            lastObservedDurationMs = player.duration.takeIf { it > 0L }
        }
        eventEmitter?.invoke(
            "media.position.changed",
            MediaStateMapper.mapPositionToMap(
                activePlayer,
                currentCastSnapshot().takeIf { it.connected },
            ),
        )
    }

    private fun notifyQueueChanged() {
        val player = activePlayer
        eventEmitter?.invoke(
            "media.queue.changed",
            mapOf(
                "queueIndex" to (player?.currentMediaItemIndex ?: 0),
                "queueLength" to (player?.mediaItemCount ?: 0),
            ),
        )
    }

    private fun notifyItemEnded(item: MediaItem) {
        val media = EpisodeMedia.fromMediaItem(item) ?: return
        if (lastCompletedMediaId == media.episodeId) return
        lastCompletedMediaId = media.episodeId
        // Retain played downloads for one day before scheduled cleanup.
        PodwaffleCachePolicy.markPlayed(this, media.episodeId)
        persistPlayback()
        val extras = item.mediaMetadata.extras
        val observed = item.mediaId == lastObservedMediaId
        val observedDurationMs = if (observed) {
            lastObservedDurationMs ?: media.durationMs
        } else {
            media.durationMs
        }
        // Guarantee a positive duration for a genuine end event. Some feeds omit
        // duration metadata and Media3 can transition before exposing a final
        // duration; reporting a matched position/duration lets the shared queue
        // remove the completed item instead of returning it as the next episode.
        val durationMs = observedDurationMs
            ?: maxOf(if (observed) lastObservedPositionMs else 0L, 1L)
        val positionMs = maxOf(
            durationMs,
            if (observed) lastObservedPositionMs else 0L,
        )
        val source = if (activePlayer === castPlayer) {
            "cast"
        } else {
            extras?.getString("source") ?: "stream"
        }
        val advancedToNext = activePlayer?.currentMediaItem?.mediaId
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

    private fun persistPlayback() {
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

    private fun restorePlayback() {
        val raw = playbackPreferences.getString("items", null) ?: return
        try {
            val array = JSONArray(raw)
            val media = buildList {
                for (index in 0 until array.length()) {
                    add(EpisodeMedia.fromJson(array.getJSONObject(index)))
                }
            }
            if (media.isEmpty()) return
            val restoredMedia = media.map { item ->
                item.withDownloadPath(
                    downloadStore?.completedPath(item.episodeId)
                        ?: item.localDownloadPath,
                )
            }
            localItems = restoredMedia.map { it.toMediaItem(useDownload = true) }
            remoteItems = restoredMedia.map { it.toMediaItem(useDownload = false) }
            val savedId = playbackPreferences.getString("mediaId", null)
            val savedIndex = playbackPreferences.getInt("index", 0)
            val index = media.indexOfFirst { it.episodeId == savedId }
                .takeIf { it >= 0 }
                ?: savedIndex.coerceIn(0, media.lastIndex)
            val position = playbackPreferences.getLong("position", 0L).coerceAtLeast(0L)
            val rate = playbackPreferences.getFloat("rate", 1f).coerceIn(0.5f, 4f)
            localPlayer?.apply {
                setMediaItems(localItems, index, position)
                playbackParameters = PlaybackParameters(rate)
                prepare()
                playWhenReady = false
            }
            lastMediaItem = localItems.getOrNull(index)
            lastObservedMediaId = lastMediaItem?.mediaId
            lastObservedPositionMs = position
            lastObservedDurationMs = media.getOrNull(index)?.durationMs
        } catch (_: Exception) {
            clearPersistedPlayback()
        }
    }

    private fun clearPersistedPlayback() {
        playbackPreferences.edit().clear().apply()
    }

    private fun scheduleCastPickerTimeout() {
        clearCastPickerTimeout()
        castPickerTimeout = Runnable {
            if (!isCasting()) {
                castConnecting = false
                val position = pendingCastPositionMs
                val resume = pendingCastAutoplay
                transferToLocal(position, resume)
            }
        }.also { handler.postDelayed(it, 30_000L) }
    }

    private fun clearCastPickerTimeout() {
        castPickerTimeout?.let(handler::removeCallbacks)
        castPickerTimeout = null
    }

    private fun clearPendingCast() {
        pendingCastEpisodeId = null
        pendingCastPositionMs = 0L
        pendingCastAutoplay = false
    }

    private fun upsertQueueItem(items: List<MediaItem>, item: MediaItem): List<MediaItem> {
        val index = items.indexOfFirst { it.mediaId == item.mediaId }
        if (index < 0) return listOf(item) + items
        return items.toMutableList().also { it[index] = item }
    }

    private fun emitError(code: String, message: String) {
        eventEmitter?.invoke("media.error", mapOf("code" to code, "message" to message))
    }

    override fun onUpdateNotification(
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
    }

    override fun onDestroy() {
        persistPlayback()
        clearCastPickerTimeout()
        positionNotifier?.let(handler::removeCallbacks)
        downloadStore?.release()
        castPlayer?.setSessionAvailabilityListener(null)
        castPlayer?.removeListener(castPlayerListener)
        castPlayer?.release()
        localPlayer?.removeListener(localPlayerListener)
        mediaSession?.release()
        localPlayer?.release()
        mediaSession = null
        castPlayer = null
        localPlayer = null
        activePlayer = null
        downloadStore = null
        instance = null
        super.onDestroy()
    }
}

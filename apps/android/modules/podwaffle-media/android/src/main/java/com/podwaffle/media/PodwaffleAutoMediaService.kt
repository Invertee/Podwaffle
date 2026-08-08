package com.podwaffle.media

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.media3.cast.CastPlayer
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.CommandButton
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaConstants
import androidx.media3.session.MediaController
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaLibraryService.LibraryParams
import androidx.media3.session.MediaLibraryService.MediaLibrarySession
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import androidx.media3.session.SessionToken
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import java.util.concurrent.Executor

/**
 * Android Auto browse service.
 *
 * Android Auto supplies the driver-safe UI. This service only exposes the
 * Podcasts -> Episodes hierarchy and attaches its library session to the same
 * native player owned by PodwaffleMediaService. No Cast chooser, show notes, or
 * phone-only actions are advertised to the car host.
 */
@UnstableApi
class PodwaffleAutoMediaService : MediaLibraryService() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val mainExecutor = Executor { command -> mainHandler.post(command) }
    private val addToQueueCommand = SessionCommand(COMMAND_ADD_TO_QUEUE, Bundle.EMPTY)
    private val addToQueueButton = CommandButton.Builder(CommandButton.ICON_QUEUE_ADD)
        .setDisplayName("Add to queue")
        .setSessionCommand(addToQueueCommand)
        .build()

    private var fallbackPlayer: ExoPlayer? = null
    private var playbackPlayer: Player? = null
    private var serviceController: MediaController? = null
    private var serviceControllerFuture: ListenableFuture<MediaController>? = null
    private var librarySession: MediaLibrarySession? = null
    private var catalog: PodwaffleAutoCatalog? = null
    private var downloadStore: PodwaffleDownloadStore? = null
    private var playbackReporter: PodwaffleAutoPlaybackReporter? = null
    private var attachAttempts = 0
    private var attachPlayerRunnable: Runnable? = null
    private var stateReportRunnable: Runnable? = null
    private var periodicStateRunnable: Runnable? = null

    private val playbackListener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) {
            scheduleStateReport(STATE_CHANGE_DEBOUNCE_MS)
        }
    }

    override fun onCreate() {
        super.onCreate()
        NativeConfigurationPersistence.load(this)
        NotificationHelper.createNotificationChannels(this)
        catalog = PodwaffleAutoCatalog(this)
        downloadStore = PodwaffleDownloadStore(this) { _, _ -> }
        playbackReporter = PodwaffleAutoPlaybackReporter(this)

        val fallback = ExoPlayer.Builder(this)
            .setSeekBackIncrementMs(
                NativeConfigurationStore.current?.skipBackwardMs ?: DEFAULT_SKIP_BACK_MS,
            )
            .setSeekForwardIncrementMs(
                NativeConfigurationStore.current?.skipForwardMs ?: DEFAULT_SKIP_FORWARD_MS,
            )
            .build()
            .also { player ->
                player.setHandleAudioBecomingNoisy(true)
                player.setPauseAtEndOfMediaItems(false)
            }
        fallbackPlayer = fallback

        val callback = AutoLibraryCallback()
        val sessionBuilder = MediaLibrarySession.Builder(this, fallback, callback)
            .setId(AUTO_SESSION_ID)
            .setCommandButtonsForMediaItems(listOf(addToQueueButton))
        createSessionActivity()?.let(sessionBuilder::setSessionActivity)
        librarySession = sessionBuilder.build()

        val notificationProvider = DefaultMediaNotificationProvider.Builder(this)
            .setChannelId(NotificationHelper.PLAYBACK_CHANNEL_ID)
            .setNotificationId(AUTO_FALLBACK_NOTIFICATION_ID)
            .build()
        notificationProvider.setSmallIcon(R.drawable.ic_podwaffle_notification)
        setMediaNotificationProvider(notificationProvider)

        bindPlaybackService()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? =
        librarySession

    override fun onUpdateNotification(
        session: MediaSession,
        startInForegroundRequired: Boolean,
    ) {
        if (playbackPlayer == null) {
            super.onUpdateNotification(session, startInForegroundRequired)
        }
        // PodwaffleMediaService owns the foreground notification once the Auto
        // library is attached to its player, preventing a duplicate media card.
    }

    private fun bindPlaybackService() {
        val token = SessionToken(
            this,
            ComponentName(this, PodwaffleMediaService::class.java),
        )
        val future = MediaController.Builder(this, token).buildAsync()
        serviceControllerFuture = future
        future.addListener(
            {
                runCatching { future.get() }
                    .onSuccess { controller ->
                        serviceController = controller
                        attachAttempts = 0
                        schedulePlayerAttachment()
                    }
            },
            mainExecutor,
        )
        schedulePlayerAttachment()
    }

    private fun schedulePlayerAttachment() {
        attachPlayerRunnable?.let(mainHandler::removeCallbacks)
        attachPlayerRunnable = object : Runnable {
            override fun run() {
                if (attachMainPlayerIfAvailable()) return
                attachAttempts += 1
                if (attachAttempts < MAX_ATTACH_ATTEMPTS) {
                    mainHandler.postDelayed(this, ATTACH_RETRY_MS)
                }
            }
        }.also(mainHandler::post)
    }

    private fun attachMainPlayerIfAvailable(allowCastHandoff: Boolean = false): Boolean {
        val service = PodwaffleMediaService.instance ?: return false
        if (allowCastHandoff && service.getCastState()["connected"] == true) {
            service.stopCast(true)
        }
        val player = service.getPlayer() ?: return false
        if (player is CastPlayer) return false
        if (playbackPlayer === player) return true

        playbackPlayer?.removeListener(playbackListener)
        librarySession?.setPlayer(player)
        playbackPlayer = player
        player.addListener(playbackListener)
        fallbackPlayer?.release()
        fallbackPlayer = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        startPeriodicStateReporting()
        scheduleStateReport(0L)
        return true
    }

    private fun scheduleStateReport(delayMs: Long) {
        stateReportRunnable?.let(mainHandler::removeCallbacks)
        stateReportRunnable = Runnable {
            stateReportRunnable = null
            reportCurrentState()
        }.also { runnable -> mainHandler.postDelayed(runnable, delayMs.coerceAtLeast(0L)) }
    }

    private fun startPeriodicStateReporting() {
        periodicStateRunnable?.let(mainHandler::removeCallbacks)
        periodicStateRunnable = object : Runnable {
            override fun run() {
                reportCurrentState()
                mainHandler.postDelayed(this, STATE_REPORT_INTERVAL_MS)
            }
        }.also { runnable -> mainHandler.postDelayed(runnable, STATE_REPORT_INTERVAL_MS) }
    }

    private fun reportCurrentState() {
        // The regular React Native controller already reports richer playback
        // state and telemetry whenever its bridge is attached.
        if (PodwaffleMediaService.eventEmitter != null) return
        val player = playbackPlayer ?: return
        val episodeId = player.currentMediaItem?.mediaId ?: return
        val durationMs = player.duration.takeIf { it > 0L && it != C.TIME_UNSET }
        val state = when {
            player.playbackState == Player.STATE_ENDED -> "stopped"
            player.isPlaying ||
                (player.playWhenReady &&
                    (player.playbackState == Player.STATE_READY ||
                        player.playbackState == Player.STATE_BUFFERING)) -> "playing"
            else -> "paused"
        }
        playbackReporter?.report(
            episodeId = episodeId,
            positionMs = player.currentPosition.coerceAtLeast(0L),
            durationMs = durationMs,
            state = state,
            playbackRate = player.playbackParameters.speed,
        )
    }

    private fun styledRootParams(params: LibraryParams?): LibraryParams {
        val extras = Bundle(params?.extras ?: Bundle.EMPTY).apply {
            putInt(
                MediaConstants.EXTRAS_KEY_CONTENT_STYLE_BROWSABLE,
                MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_GRID_ITEM,
            )
            putInt(
                MediaConstants.EXTRAS_KEY_CONTENT_STYLE_PLAYABLE,
                MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM,
            )
        }
        return LibraryParams.Builder()
            .setRecent(params?.isRecent ?: false)
            .setOffline(params?.isOffline ?: false)
            .setSuggested(params?.isSuggested ?: false)
            .setExtras(extras)
            .build()
    }

    private fun withQueueCommand(item: MediaItem): MediaItem {
        if (item.mediaMetadata.isPlayable != true) return item
        return item.buildUpon()
            .setMediaMetadata(
                item.mediaMetadata.buildUpon()
                    .setSupportedCommands(listOf(COMMAND_ADD_TO_QUEUE))
                    .build(),
            )
            .build()
    }

    private fun enqueueResolvedItems(items: List<MediaItem>): Boolean {
        if (items.isEmpty() || !attachMainPlayerIfAvailable()) return false
        val player = playbackPlayer ?: return false
        val combined = buildList {
            for (index in 0 until player.mediaItemCount) {
                add(player.getMediaItemAt(index))
            }
            val existingIds = map(MediaItem::mediaId).toMutableSet()
            items.forEach { item ->
                if (existingIds.add(item.mediaId)) add(item)
            }
        }
        val media = combined.mapNotNull(EpisodeMedia::fromMediaItem)
        if (media.isEmpty()) return false
        // Automatically cache Android Auto queue additions using the same
        // idempotent DownloadManager store as the phone queue.
        val store = requireDownloadStore()
        items.mapNotNull(EpisodeMedia::fromMediaItem).forEach { queued ->
            // Cancel played-cache cleanup for Android Auto queue additions.
            PodwaffleCachePolicy.markQueued(this, queued.episodeId)
            if (
                queued.enclosureUrl.isNotBlank() &&
                store.completedPath(queued.episodeId) == null
            ) {
                runCatching { store.add(queued.toMap(), "automatic") }
            }
        }
        PodwaffleMediaService.instance?.setQueue(
            local = media.map { it.toMediaItem(useDownload = true) },
            remote = media.map { it.toMediaItem(useDownload = false) },
            requestedIndex = player.currentMediaItemIndex.coerceAtLeast(0),
        )
        requireCatalog().queueOnServer(items.map(MediaItem::mediaId))
        return true
    }

    private fun createSessionActivity(): PendingIntent? {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName) ?: return null
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return PendingIntent.getActivity(
            this,
            20,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    override fun onDestroy() {
        attachPlayerRunnable?.let(mainHandler::removeCallbacks)
        stateReportRunnable?.let(mainHandler::removeCallbacks)
        periodicStateRunnable?.let(mainHandler::removeCallbacks)
        attachPlayerRunnable = null
        stateReportRunnable = null
        periodicStateRunnable = null
        playbackPlayer?.removeListener(playbackListener)
        playbackPlayer = null
        serviceControllerFuture?.cancel(true)
        serviceControllerFuture = null
        serviceController?.release()
        serviceController = null
        librarySession?.release()
        librarySession = null
        fallbackPlayer?.release()
        fallbackPlayer = null
        downloadStore?.release()
        downloadStore = null
        playbackReporter?.close()
        playbackReporter = null
        catalog?.close()
        catalog = null
        super.onDestroy()
    }

    private inner class AutoLibraryCallback : MediaLibrarySession.Callback {
        override fun onConnect(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
        ): MediaSession.ConnectionResult {
            val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS
                .buildUpon()
                .add(addToQueueCommand)
                .build()
            return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                .setAvailableSessionCommands(commands)
                .build()
        }

        override fun onGetLibraryRoot(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<MediaItem>> = Futures.immediateFuture(
            LibraryResult.ofItem(requireCatalog().rootItem(), styledRootParams(params)),
        )

        override fun onGetChildren(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            parentId: String,
            page: Int,
            pageSize: Int,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
            val result = requireCatalog().children(
                parentId = parentId,
                page = page,
                pageSize = pageSize,
                params = params,
                downloadStore = requireDownloadStore(),
            )
            if (browser.maxCommandsForMediaItems <= 0) return result
            return Futures.transform(
                result,
                { libraryResult ->
                    val items = libraryResult.value
                    if (libraryResult.resultCode != LibraryResult.RESULT_SUCCESS || items == null) {
                        libraryResult
                    } else {
                        LibraryResult.ofItemList(items.map(::withQueueCommand), libraryResult.params)
                    }
                },
                mainExecutor,
            )
        }

        override fun onGetItem(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            mediaId: String,
        ): ListenableFuture<LibraryResult<MediaItem>> {
            val result = requireCatalog().item(mediaId, requireDownloadStore())
            if (browser.maxCommandsForMediaItems <= 0) return result
            return Futures.transform(
                result,
                { libraryResult ->
                    val item = libraryResult.value
                    if (libraryResult.resultCode != LibraryResult.RESULT_SUCCESS || item == null) {
                        libraryResult
                    } else {
                        LibraryResult.ofItem(withQueueCommand(item), libraryResult.params)
                    }
                },
                mainExecutor,
            )
        }

        override fun onSetMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: List<MediaItem>,
            startIndex: Int,
            startPositionMs: Long,
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            // Selecting an Auto episode means local phone playback. An existing
            // Cast session is stopped rather than exposed through the car UI.
            if (!attachMainPlayerIfAvailable(allowCastHandoff = true)) {
                return Futures.immediateFuture(
                    MediaSession.MediaItemsWithStartPosition(
                        emptyList(),
                        C.INDEX_UNSET,
                        C.TIME_UNSET,
                    ),
                )
            }
            val resolved = requireCatalog().resolvePlayable(
                mediaItems,
                requireDownloadStore(),
            )
            if (resolved.isEmpty()) {
                return Futures.immediateFuture(
                    MediaSession.MediaItemsWithStartPosition(
                        emptyList(),
                        C.INDEX_UNSET,
                        C.TIME_UNSET,
                    ),
                )
            }
            val index = if (startIndex == C.INDEX_UNSET) {
                0
            } else {
                startIndex.coerceIn(0, resolved.lastIndex)
            }
            val requestedPosition = if (startPositionMs == C.TIME_UNSET) {
                resolved[index].mediaMetadata.extras
                    ?.getLong("resumePositionMs", 0L)
                    ?.coerceAtLeast(0L)
                    ?: 0L
            } else {
                startPositionMs.coerceAtLeast(0L)
            }

            // Keep the main service's persisted local/remote queue metadata in
            // step with the item selected by Android Auto. The library session
            // will apply the same resolved item after this callback returns.
            EpisodeMedia.fromMediaItem(resolved[index])?.let { media ->
                PodwaffleMediaService.instance?.playEpisode(
                    local = media.toMediaItem(useDownload = true),
                    remote = media.toMediaItem(useDownload = false),
                    startPositionMs = requestedPosition,
                    autoplay = false,
                )
            }
            requireCatalog().acquirePlayback(
                resolved[index].mediaId,
                requestedPosition,
            )
            return Futures.immediateFuture(
                MediaSession.MediaItemsWithStartPosition(
                    resolved,
                    index,
                    requestedPosition,
                ),
            )
        }

        override fun onAddMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: List<MediaItem>,
        ): ListenableFuture<List<MediaItem>> {
            val resolved = requireCatalog().resolvePlayable(
                mediaItems,
                requireDownloadStore(),
            )
            enqueueResolvedItems(resolved)
            // The shared player queue was updated directly. Returning an empty
            // list prevents MediaSession from appending the same items twice.
            return Futures.immediateFuture(emptyList())
        }

        override fun onCustomCommand(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand,
            args: Bundle,
        ): ListenableFuture<SessionResult> {
            if (customCommand.customAction != COMMAND_ADD_TO_QUEUE) {
                return Futures.immediateFuture(
                    SessionResult(SessionError.ERROR_NOT_SUPPORTED),
                )
            }
            val mediaId = args.getString(MediaConstants.EXTRA_KEY_MEDIA_ID)
            if (mediaId.isNullOrBlank()) {
                return Futures.immediateFuture(SessionResult(SessionError.ERROR_BAD_VALUE))
            }
            return Futures.transform(
                requireCatalog().item(mediaId, requireDownloadStore()),
                { result ->
                    val item = result.value
                    if (
                        result.resultCode == LibraryResult.RESULT_SUCCESS &&
                        item != null &&
                        item.mediaMetadata.isPlayable == true &&
                        enqueueResolvedItems(listOf(item))
                    ) {
                        SessionResult(SessionResult.RESULT_SUCCESS)
                    } else {
                        SessionResult(SessionError.ERROR_INVALID_STATE)
                    }
                },
                mainExecutor,
            )
        }
    }

    private fun requireCatalog(): PodwaffleAutoCatalog =
        requireNotNull(catalog) { "Android Auto catalogue is unavailable" }

    private fun requireDownloadStore(): PodwaffleDownloadStore {
        val serviceStore = runCatching {
            PodwaffleMediaService.instance?.getDownloadStore()
        }.getOrNull()
        return serviceStore
            ?: requireNotNull(downloadStore) { "Download store is unavailable" }
    }

    companion object {
        const val COMMAND_ADD_TO_QUEUE = "com.podwaffle.media.command.ADD_TO_QUEUE"
        private const val AUTO_SESSION_ID = "podwaffle-android-auto"
        private const val AUTO_FALLBACK_NOTIFICATION_ID = 1003
        private const val DEFAULT_SKIP_BACK_MS = 15_000L
        private const val DEFAULT_SKIP_FORWARD_MS = 30_000L
        private const val ATTACH_RETRY_MS = 100L
        private const val MAX_ATTACH_ATTEMPTS = 100
        private const val STATE_CHANGE_DEBOUNCE_MS = 250L
        private const val STATE_REPORT_INTERVAL_MS = 10_000L
    }
}
